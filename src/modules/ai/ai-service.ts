import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { Message } from "../../db/schema.js";
import { config } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { retrieveKnowledge } from "./knowledge-base.js";
import { consultarStatusPedido } from "./order-status-tool.js";

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
  return history.slice(-10).map((message): BaseMessage => {
    if (message.direction === "outbound") {
      return new AIMessage(message.body);
    }

    return new HumanMessage(message.body);
  });
}

function buildSystemPrompt(context: string) {
  return [
    "Voce e um atendente da NeoFibra no WhatsApp.",
    "Responda em portugues brasileiro, de forma objetiva e cordial.",
    "Use apenas as informacoes da base de conhecimento e das ferramentas disponiveis.",
    "Se a informacao nao estiver disponivel, diga que nao sabe e indique atendimento humano.",
    "Nao invente precos, prazos, cobertura, SLA ou status.",
    "",
    "Base de conhecimento relevante:",
    context || "Nenhum trecho relevante foi encontrado.",
  ].join("\n");
}

async function generateLocalReply(question: string) {
  const protocol = question.match(/\bPED-\d{4,}\b/i)?.[0];
  if (protocol) {
    return consultarStatusPedido(protocol);
  }

  const context = await retrieveKnowledge(question, 2);
  if (context.length === 0) {
    return "Nao encontrei essa informacao na base de conhecimento. Posso encaminhar para atendimento humano.";
  }

  return context
    .join("\n\n")
    .replace(/^#\s+/gm, "")
    .slice(0, 900);
}

export async function generateReply(input: GenerateReplyInput) {
  if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.includes("troque-pela-sua-chave")) {
    return generateLocalReply(input.question);
  }

  const context = (await retrieveKnowledge(input.question)).join("\n\n---\n\n");
  const messages: BaseMessage[] = [
    new SystemMessage(buildSystemPrompt(context)),
    ...toLangChainHistory(input.history),
  ];

  const model = new ChatOpenAI({
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
    temperature: 0.1,
    maxRetries: 2,
  });

  const modelWithTools = model.bindTools([statusTool], {
    tool_choice: "auto",
  });

  const firstResponse = await modelWithTools.invoke(messages);
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
