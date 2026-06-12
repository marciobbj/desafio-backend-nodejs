import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { db } from "../../db/client.js";
import type { Message } from "../../db/schema.js";
import { config } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { searchKnowledgeBase } from "./knowledge-base.js";
import { consultarStatusPedido } from "./order-status-tool.js";
import { getTenantAiSettings } from "./tenant-ai-settings.js";

export type GenerateReplyInput = {
  tenantId: string;
  conversationId: string;
  history: Message[];
  question: string;
};

const statusTool = {
  name: "consultar_status_pedido",
  description: "Consulta o status de um pedido ou chamado pelo protocolo no formato PED-XXXX.",
  schema: z.object({
    protocol: z.string().describe("Protocolo do pedido ou chamado, no formato PED-XXXX."),
  }),
};

function messageContentToString(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function toLangChainHistory(history: Message[]) {
  const merged: BaseMessage[] = [];

  for (const message of history.slice(-10)) {
    const isOutbound = message.direction === "outbound";
    const last = merged[merged.length - 1];

    if (last) {
      if (isOutbound && last instanceof AIMessage) {
        last.content = (typeof last.content === "string" ? last.content : "") + "\n" + message.body;
        continue;
      }
      if (!isOutbound && last instanceof HumanMessage) {
        last.content = (typeof last.content === "string" ? last.content : "") + "\n" + message.body;
        continue;
      }
    }

    if (isOutbound) {
      merged.push(new AIMessage(message.body));
    } else {
      merged.push(new HumanMessage(message.body));
    }
  }

  if (merged[0] instanceof AIMessage) {
    merged.shift();
  }

  return merged;
}

function isPlaceholderApiKey(apiKey: string | undefined) {
  return !apiKey || apiKey.includes("troque-pela-sua-chave");
}

function normalizeOpenAiBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "").endsWith("/v1") ? baseUrl.replace(/\/$/, "") : `${baseUrl.replace(/\/$/, "")}/v1`;
}

export async function generateReply(input: GenerateReplyInput) {
  const aiSettings = await getTenantAiSettings(db, input.tenantId);

  // Verifica se o orçamento mensal foi configurado e se o limite de gastos foi atingido
  if (
    aiSettings.monthlyBudgetUsd !== undefined &&
    aiSettings.currentMonthSpendUsd !== undefined &&
    aiSettings.currentMonthSpendUsd >= aiSettings.monthlyBudgetUsd
  ) {
    logger.warn(
      {
        tenantId: input.tenantId,
        monthlyBudgetUsd: aiSettings.monthlyBudgetUsd,
        currentMonthSpendUsd: aiSettings.currentMonthSpendUsd,
      },
      "Tenant monthly budget exceeded, skipping LLM invocation and returning fallback message",
    );
    return "Desculpe, o limite de processamento de mensagens foi atingido. Por favor, tente novamente mais tarde.";
  }

  if (!config.OPENAI_BASE_URL && isPlaceholderApiKey(config.OPENAI_API_KEY)) {
    throw new Error("LLM provider is not configured. Set OPENAI_BASE_URL for LM Studio or OPENAI_API_KEY for OpenAI.");
  }

  const context = await searchKnowledgeBase(db, input.tenantId, input.question);
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", aiSettings.systemPrompt],
    new MessagesPlaceholder("history"),
  ]);
  const messages = await prompt.formatMessages({
    tenantName: aiSettings.tenantName,
    context: context || "Nenhum trecho relevante foi encontrado.",
    history: toLangChainHistory(input.history),
  });

  const model = new ChatOpenAI({
    apiKey: isPlaceholderApiKey(config.OPENAI_API_KEY) ? "lm-studio" : config.OPENAI_API_KEY,
    model: aiSettings.model ?? config.OPENAI_MODEL,
    temperature: aiSettings.temperature ?? 0.1,
    timeout: config.LLM_REQUEST_TIMEOUT_MS,
    maxRetries: 2,
    configuration: config.OPENAI_BASE_URL
      ? {
          baseURL: normalizeOpenAiBaseUrl(config.OPENAI_BASE_URL),
        }
      : undefined,
  });

  logger.info(
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      model: aiSettings.model ?? config.OPENAI_MODEL,
      baseURL: config.OPENAI_BASE_URL,
      timeoutMs: config.LLM_REQUEST_TIMEOUT_MS,
      toolCallingEnabled: aiSettings.toolCallingEnabled ?? config.LLM_TOOL_CALLING_ENABLED,
    },
    "Generating reply with LangChain chat model",
  );

  if (!(aiSettings.toolCallingEnabled ?? config.LLM_TOOL_CALLING_ENABLED)) {
    const response = await model.invoke(messages);
    return (
      messageContentToString(response.content) ||
      "Nao consegui gerar uma resposta com seguranca a partir da base de conhecimento. Posso encaminhar para atendimento humano."
    );
  }

  const modelWithTools = model.bindTools([statusTool], {
    tool_choice: "auto",
  });

  let firstResponse: AIMessage;
  try {
    firstResponse = await modelWithTools.invoke(messages);
  } catch (err) {
    if (!config.OPENAI_BASE_URL) {
      throw err;
    }

    logger.warn(
      { err, tenantId: input.tenantId, conversationId: input.conversationId },
      "LLM tool call failed on OpenAI-compatible endpoint; retrying without tools",
    );
    const response = await model.invoke(messages);
    return (
      messageContentToString(response.content) ||
      "Nao consegui gerar uma resposta com seguranca a partir da base de conhecimento. Posso encaminhar para atendimento humano."
    );
  }
  const toolCalls = firstResponse.tool_calls ?? [];

  if (toolCalls.length === 0) {
    return messageContentToString(firstResponse.content);
  }

  const toolMessages = toolCalls.map((toolCall) => {
    if (toolCall.name !== "consultar_status_pedido") {
      return new ToolMessage({
        tool_call_id: toolCall.id ?? toolCall.name,
        content: `Ferramenta desconhecida: ${toolCall.name}`,
        status: "error",
      });
    }

    const parsedArgs = z.object({ protocol: z.string() }).safeParse(toolCall.args);
    const content = parsedArgs.success
      ? consultarStatusPedido(parsedArgs.data.protocol)
      : "Argumentos invalidos para consultar_status_pedido.";

    logger.info(
      {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        toolName: toolCall.name,
        protocol: parsedArgs.success ? parsedArgs.data.protocol : undefined,
      },
      "Executed LLM tool call",
    );

    return new ToolMessage({
      tool_call_id: toolCall.id ?? toolCall.name,
      content,
      status: parsedArgs.success ? "success" : "error",
    });
  });

  const finalResponse = await model.invoke([...messages, firstResponse, ...toolMessages]);
  const answer = messageContentToString(finalResponse.content);

  return (
    answer ||
    "Nao consegui gerar uma resposta com seguranca a partir da base de conhecimento. Posso encaminhar para atendimento humano."
  );
}
