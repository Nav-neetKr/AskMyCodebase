import "dotenv/config";
import express from "express";
import path from "path";
import { ingestRepo } from "./src/ingest.js";
import { answerQuestion } from "./src/chat.js";
import { listRepos } from "./src/vectorstore.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.resolve("./public")));

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// In-memory job status for the (single) most recent ingest, for progress polling.
const jobs = new Map();

app.get("/api/config", (_req, res) => {
  // The Supabase anon key is intentionally public; authorization is enforced
  // server-side with each user's access token.
  res.json({ supabaseUrl: SUPABASE_URL || null, supabaseAnonKey: SUPABASE_ANON_KEY || null });
});

async function requireUser(req, res, next) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Authentication is not configured on the server" });
  }

  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Sign in is required" });
  }

  try {
    // Supabase validates the access token and returns the corresponding user.
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization },
    });
    if (!response.ok) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    const user = await response.json();
    if (!user?.id) return res.status(401).json({ error: "Invalid user session" });
    req.user = { id: user.id, email: user.email };
    req.accessToken = authorization.slice("Bearer ".length);
    next();
  } catch (err) {
    console.error("Authentication check failed", err);
    res.status(503).json({ error: "Authentication service is unavailable" });
  }
}

function isSupportedRepoUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["github.com", "www.github.com"].includes(url.hostname) && parts.length === 2;
  } catch {
    return false;
  }
}

app.post("/api/ingest", requireUser, async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });
  if (!isSupportedRepoUrl(repoUrl)) {
    return res.status(400).json({ error: "Use a public HTTPS GitHub repository URL" });
  }
  if (!VOYAGE_API_KEY) return res.status(500).json({ error: "VOYAGE_API_KEY not configured on server" });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { ownerId: req.user.id, stage: "starting", message: "Starting..." });

  ingestRepo(repoUrl, req.user.id, req.accessToken, VOYAGE_API_KEY, (progress) =>
    jobs.set(jobId, { ownerId: req.user.id, ...progress })
  )
    .then((result) => jobs.set(jobId, { ownerId: req.user.id, stage: "complete", ...result }))
    .catch((err) => jobs.set(jobId, { ownerId: req.user.id, stage: "error", message: err.message }));

  res.json({ jobId });
});

app.get("/api/ingest/status", requireUser, (req, res) => {
  const { jobId } = req.query;
  const job = jobs.get(jobId);
  if (!job || job.ownerId !== req.user.id) return res.status(404).json({ error: "Ingest job not found" });
  const { ownerId: _ownerId, ...safeJob } = job;
  res.json(safeJob);
});

app.get("/api/repos", requireUser, async (req, res) => {
  try {
    res.json(await listRepos(req.accessToken));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chat", requireUser, async (req, res) => {
  const { repoId, question } = req.body;
  if (!repoId || !question) return res.status(400).json({ error: "repoId and question are required" });
  if (!VOYAGE_API_KEY) return res.status(500).json({ error: "VOYAGE_API_KEY not configured on server" });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });

  try {
    const result = await answerQuestion(repoId, req.accessToken, question, VOYAGE_API_KEY);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ask My Codebase running on http://localhost:${PORT}`));
