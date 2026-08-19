import fetch from "node-fetch";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

// Batches chunks (Voyage allows up to 128 inputs per request) and returns
// an array of { ...chunk, embedding: number[] }
export async function embedChunks(chunks, apiKey, model = "voyage-code-2") {
  const BATCH = 100;
  const results = [];

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: batch.map((c) => c.text.slice(0, 8000)), // guard against oversized chunks
        model,
        input_type: "document",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Voyage embedding request failed: ${res.status} ${errText}`);
    }

    const data = await res.json();
    data.data.forEach((item, idx) => {
      results.push({ ...batch[idx], embedding: item.embedding });
    });

    console.log(`Embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length} chunks`);
  }

  return results;
}

export async function embedQuery(query, apiKey, model = "voyage-code-2") {
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [query], model, input_type: "query" }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage embedding request failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}
