import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type KnowledgeDocument = {
  source: string;
  content: string;
};

let cachedDocuments: KnowledgeDocument[] | null = null;
let cachedContext: string | null = null;

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
