import simpleGit from "simple-git";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { chunkRepo } from "./chunker.js";
import { embedChunks } from "./embeddings.js";
import { saveRepoChunks } from "./vectorstore.js";

export async function ingestRepo(repoUrl, ownerId, accessToken, voyageApiKey, onProgress = () => {}) {
  const repoId = uuidv4();
  const tmpDir = path.join(os.tmpdir(), `amc-${repoId}`);

  try {
    onProgress({ stage: "cloning", message: `Cloning ${repoUrl}...` });
    await simpleGit().clone(repoUrl, tmpDir, ["--depth", "1"]);

    onProgress({ stage: "chunking", message: "Splitting code into chunks..." });
    const chunks = chunkRepo(tmpDir);
    if (chunks.length === 0) {
      throw new Error("No supported source files found (java, js, ts, py).");
    }

    onProgress({ stage: "embedding", message: `Embedding ${chunks.length} chunks...` });
    const embedded = await embedChunks(chunks, voyageApiKey);

    const repoName = repoUrl.split("/").filter(Boolean).pop().replace(/\.git$/, "");
    await saveRepoChunks(repoId, embedded, { repoUrl, repoName, ownerId, indexedAt: new Date().toISOString() }, accessToken);

    onProgress({ stage: "done", message: "Ready to chat." });
    return { repoId, repoName, chunkCount: chunks.length };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
