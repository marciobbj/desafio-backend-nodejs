import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql, cosineDistance } from "drizzle-orm";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { DbClient } from "../../db/client.js";
import { knowledgeBaseEmbeddings } from "../../db/schema.js";
import { config } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";

type KnowledgeDocument = {
  source: string;
  content: string;
};

let cachedDocuments: KnowledgeDocument[] | null = null;
let cachedContext: string | null = null;

function isPlaceholderApiKey(apiKey: string | undefined) {
  return !apiKey || apiKey.includes("troque-pela-sua-chave");
}

function normalizeOpenAiBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "").endsWith("/v1")
    ? baseUrl.replace(/\/$/, "")
    : `${baseUrl.replace(/\/$/, "")}/v1`;
}

export function getEmbeddingsModel() {
  return new OpenAIEmbeddings({
    apiKey: isPlaceholderApiKey(config.OPENAI_API_KEY) ? "lm-studio" : config.OPENAI_API_KEY,
    model: "text-embedding-3-small",
    configuration: config.OPENAI_BASE_URL
      ? {
          baseURL: normalizeOpenAiBaseUrl(config.OPENAI_BASE_URL),
        }
      : undefined,
  });
}

export function splitIntoChunks(text: string, maxChunkSize = 600, overlap = 100): string[] {
  const paragraphs = text.split("\n\n");
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if ((currentChunk + "\n\n" + trimmed).length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      if (overlap > 0 && currentChunk) {
        currentChunk = currentChunk.slice(-overlap) + "\n\n" + trimmed;
      } else {
        currentChunk = trimmed;
      }
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + trimmed : trimmed;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export async function loadKnowledgeBase() {
  if (cachedDocuments) {
    return cachedDocuments;
  }

  const baseDir = join(process.cwd(), "knowledge-base");
  const files = (await readdir(baseDir)).filter((file) => file.endsWith(".md")).sort();
  const documents: KnowledgeDocument[] = [];

  for (const file of files) {
    const content = await readFile(join(baseDir, file), "utf8");
    documents.push({
      source: file,
      content: content.trim(),
    });
  }

  cachedDocuments = documents;
  return documents;
}

export async function loadKnowledgeBaseContext() {
  if (cachedContext) {
    return cachedContext;
  }

  const documents = await loadKnowledgeBase();
  cachedContext = documents
    .map((document) => `[${document.source}]\n${document.content}`)
    .join("\n\n---\n\n");

  return cachedContext;
}

export async function ensureEmbeddingsPopulated(db: DbClient, tenantId: string) {
  const existingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeBaseEmbeddings)
    .where(eq(knowledgeBaseEmbeddings.tenantId, tenantId));

  if (existingCount[0]?.count && existingCount[0].count > 0) {
    return;
  }

  logger.info({ tenantId }, "Populating knowledge base embeddings for tenant");
  const documents = await loadKnowledgeBase();
  const embeddingsModel = getEmbeddingsModel();

  const allChunks: { source: string; content: string }[] = [];
  for (const doc of documents) {
    const chunks = splitIntoChunks(doc.content);
    for (const chunk of chunks) {
      allChunks.push({ source: doc.source, content: chunk });
    }
  }

  if (allChunks.length === 0) return;

  const rawContents = allChunks.map((c) => c.content);
  const embeddings = await embeddingsModel.embedDocuments(rawContents);

  const valuesToInsert = allChunks.map((chunk, index) => ({
    tenantId,
    source: chunk.source,
    content: chunk.content,
    embedding: embeddings[index],
  }));

  await db.insert(knowledgeBaseEmbeddings).values(valuesToInsert);
  logger.info({ tenantId, chunksCount: allChunks.length }, "Successfully populated embeddings");
}

export async function searchKnowledgeBase(db: DbClient, tenantId: string, query: string, k = 3): Promise<string> {
  try {
    await ensureEmbeddingsPopulated(db, tenantId);

    const embeddingsModel = getEmbeddingsModel();
    const queryEmbeddings = await embeddingsModel.embedDocuments([query]);
    const queryEmbedding = queryEmbeddings[0];
    if (!queryEmbedding) {
      throw new Error("Failed to generate embedding for query");
    }

    const results = await db
      .select({
        source: knowledgeBaseEmbeddings.source,
        content: knowledgeBaseEmbeddings.content,
      })
      .from(knowledgeBaseEmbeddings)
      .where(eq(knowledgeBaseEmbeddings.tenantId, tenantId))
      .orderBy(cosineDistance(knowledgeBaseEmbeddings.embedding, queryEmbedding))
      .limit(k);

    if (results.length === 0) {
      return "";
    }

    return results
      .map((row) => `[${row.source}]\n${row.content}`)
      .join("\n\n---\n\n");
  } catch (err) {
    logger.warn(
      { err, tenantId },
      "Vector search failed, falling back to full context loading",
    );
    return loadKnowledgeBaseContext();
  }
}
