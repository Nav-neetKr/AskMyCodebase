const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TABLE = "codebase_repos";

function apiUrl(path = "") {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase is not configured on the server");
  return `${SUPABASE_URL}/rest/v1/${TABLE}${path}`;
}

async function databaseRequest(path, accessToken, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not access your repository data (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function saveRepoChunks(repoId, chunks, meta, accessToken) {
  await databaseRequest("", accessToken, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      repo_id: repoId, owner_id: meta.ownerId, repo_url: meta.repoUrl,
      repo_name: meta.repoName, indexed_at: meta.indexedAt,
      chunk_count: chunks.length, chunks,
    }),
  });
}

export async function loadRepoChunks(repoId, accessToken) {
  const rows = await databaseRequest(`?repo_id=eq.${encodeURIComponent(repoId)}&select=chunks`, accessToken);
  return rows[0] || null;
}

export async function listRepos(accessToken) {
  const rows = await databaseRequest("?select=repo_id,repo_name,chunk_count,indexed_at&order=indexed_at.desc", accessToken);
  return rows.map((row) => ({ repoId: row.repo_id, repoName: row.repo_name, chunkCount: row.chunk_count, indexedAt: row.indexed_at }));
}

function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function search(repoId, accessToken, queryEmbedding, topK = 8) {
  const data = await loadRepoChunks(repoId, accessToken);
  if (!data) throw new Error(`No indexed data for repo "${repoId}"`);
  const scored = data.chunks.map((c) => ({ ...c, score: cosineSim(c.embedding, queryEmbedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
