import Anthropic from "@anthropic-ai/sdk";
import { embedQuery } from "./embeddings.js";
import { search } from "./vectorstore.js";

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

export async function answerQuestion(repoId, ownerId, question, voyageApiKey) {
  const queryEmbedding = await embedQuery(question, voyageApiKey);
  const matches = search(repoId, ownerId, queryEmbedding, 8);

  const context = matches
    .map(
      (m, i) =>
        `[${i + 1}] ${m.file}:${m.startLine}-${m.endLine}\n\`\`\`\n${m.text}\n\`\`\``
    )
    .join("\n\n");

  const systemPrompt = `You are a codebase assistant. Answer the user's question using ONLY the code snippets provided below as context. Cite the snippet number (e.g. [1]) and file:line for every claim you make. If the snippets don't contain enough information to answer confidently, say so plainly rather than guessing.

CODE CONTEXT:
${context}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
  });

  const answerText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    answer: answerText,
    sources: matches.map((m) => ({
      file: m.file,
      startLine: m.startLine,
      endLine: m.endLine,
      score: Number(m.score.toFixed(3)),
    })),
  };
}
