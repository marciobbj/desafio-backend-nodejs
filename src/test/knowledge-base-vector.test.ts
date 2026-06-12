import { describe, expect, it, vi } from "vitest";
import { splitIntoChunks, searchKnowledgeBase } from "../modules/ai/knowledge-base.js";

describe("Knowledge Base Vector & Chunking", () => {
  describe("splitIntoChunks", () => {
    it("splits long text into chunks by paragraphs", () => {
      const text = "Parágrafo 1. Blabla.\n\nParágrafo 2. Blabla.\n\nParágrafo 3. Blabla.";
      const chunks = splitIntoChunks(text, 30, 0);

      expect(chunks.length).toBe(3);
      expect(chunks[0]).toBe("Parágrafo 1. Blabla.");
      expect(chunks[1]).toBe("Parágrafo 2. Blabla.");
      expect(chunks[2]).toBe("Parágrafo 3. Blabla.");
    });

    it("respects overlap size", () => {
      const text = "Parágrafo 1 longo. Blabla.\n\nParágrafo 2 longo. Blabla.";
      const chunks = splitIntoChunks(text, 30, 10);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[1]).toContain("Parágrafo 2");
    });
  });

  describe("searchKnowledgeBase fallback", () => {
    it("falls back to full context when database or embeddings throw an error", async () => {
      // Mock db that throws an error
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          throw new Error("DB Error");
        }),
      } as never;

      const context = await searchKnowledgeBase(mockDb, "some-tenant-id", "Quais os planos?");
      // Should fall back to loadKnowledgeBaseContext and return the full content
      expect(context).toContain("[faq-geral.md]");
      expect(context).toContain("Fibra");
    });
  });
});
