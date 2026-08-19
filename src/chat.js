import { embedQuery } from "./embeddings.js";
import { search } from "./vectorstore.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";

export async function answerQuestion(repoId, accessToken, question, voyageApiKey) {
  const queryEmbedding = await embedQuery(question, voyageApiKey);
  const matches = await search(repoId, accessToken, queryEmbedding, 8);

  const context = matches
    .map(
      (m, i) =>
        `[${i + 1}] ${m.file}:${m.startLine}-${m.endLine}\n\`\`\`\n${m.text}\n\`\`\``
    )
    .join("\n\n");

  const systemPrompt = `You are a codebase assistant. Answer the user's question using ONLY the code snippets provided below as context. Cite the snippet number (e.g. [1]) and file:line for every claim you make. If the snippets don't contain enough information to answer confidently, say so plainly rather than guessing.

CODE CONTEXT:
${context}`;

  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured on the server");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: question }] }],
      generationConfig: { maxOutputTokens: 1500 },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "Gemini could not generate an answer");
  const answerText = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("\n");
  if (!answerText) throw new Error("Gemini returned no text response");

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
