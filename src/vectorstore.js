import fs from "fs";
import path from "path";

const STORE_DIR = path.resolve("./data");
if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });

function storePath(repoId) {
  return path.join(STORE_DIR, `${repoId}.json`);
}

export function saveRepoChunks(repoId, chunks, meta) {
  fs.writeFileSync(storePath(repoId), JSON.stringify({ meta, chunks }));
}

export function loadRepoChunks(repoId, ownerId) {
  const p = storePath(repoId);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, "utf-8"));
  // Never reveal that a repository exists to another authenticated user.
  if (ownerId && data.meta.ownerId !== ownerId) return null;
  return data;
}

export function listRepos(ownerId) {
  return fs
    .readdirSync(STORE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), "utf-8"));
      return { repoId: f.replace(".json", ""), ...data.meta, chunkCount: data.chunks.length };
    })
    .filter((repo) => repo.ownerId === ownerId)
    .map(({ ownerId: _ownerId, ...repo }) => repo);
}

function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function search(repoId, ownerId, queryEmbedding, topK = 8) {
  const data = loadRepoChunks(repoId, ownerId);
  if (!data) throw new Error(`No indexed data for repo "${repoId}"`);

  const scored = data.chunks.map((c) => ({
    ...c,
    score: cosineSim(c.embedding, queryEmbedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
