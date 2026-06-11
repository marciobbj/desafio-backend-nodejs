import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type KnowledgeChunk = {
  source: string;
  content: string;
  tokens: Set<string>;
};

let cachedChunks: KnowledgeChunk[] | null = null;

function tokenize(text: string) {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 3),
  );
}

function splitMarkdown(content: string) {
  return content
    .split(/\n(?=#{1,3}\s)|\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

export async function loadKnowledgeBase() {
  if (cachedChunks) {
    return cachedChunks;
  }

  const baseDir = join(process.cwd(), "knowledge-base");
  const files = (await readdir(baseDir)).filter((file) => file.endsWith(".md"));
  const chunks: KnowledgeChunk[] = [];

  for (const file of files) {
    const content = await readFile(join(baseDir, file), "utf8");
    for (const chunk of splitMarkdown(content)) {
      chunks.push({
        source: file,
        content: chunk,
        tokens: tokenize(chunk),
      });
    }
  }

  cachedChunks = chunks;
  return chunks;
}

export async function retrieveKnowledge(query: string, limit = 4) {
  const chunks = await loadKnowledgeBase();
  const queryTokens = tokenize(query);

  return chunks
    .map((chunk) => {
      let score = 0;
      for (const token of queryTokens) {
        if (chunk.tokens.has(token)) {
          score += 1;
        }
      }

      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((chunk) => `[${chunk.source}]\n${chunk.content}`);
}
