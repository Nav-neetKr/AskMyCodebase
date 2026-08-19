import fs from "fs";
import path from "path";

// Class/interface declarations - captured as a short "overview" chunk, not fully consumed
const CLASS_PATTERNS = {
  java: [/^\s*(public|private|protected|static|final|abstract|\s)*\s*(class|interface|enum|record)\s+\w+/],
  javascript: [/^\s*(export\s+)?(default\s+)?class\s+\w+/],
  python: [/^\s*class\s+\w+/],
};

// Method/function declarations - each captured as its own full-body chunk
const METHOD_PATTERNS = {
  java: [
    /^\s*(public|private|protected|static|final|synchronized|\s)*\s*[\w<>\[\],\s]+\s+\w+\s*\([^;]*\)\s*(\{|throws)/,
  ],
  javascript: [
    /^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*\w*\s*\(/,
    /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(?.*\)?\s*=>/,
    /^\s*\w+\s*\([^)]*\)\s*\{/, // object/class method shorthand
  ],
  python: [/^\s*(async\s+)?def\s+\w+/],
};

const EXT_TO_LANG = {
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "javascript",
  ".tsx": "javascript",
  ".py": "python",
};

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", "out",
  ".next", "venv", "__pycache__", ".idea", ".vscode", "coverage",
]);

function walkFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, files);
    } else if (EXT_TO_LANG[path.extname(entry.name)]) {
      files.push(full);
    }
  }
  return files;
}

// Extract a symbol body starting at `startLine` using brace-matching (C-like langs)
function extractByBraces(lines, startLine) {
  let depth = 0;
  let started = false;
  let end = startLine;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") { depth++; started = true; }
      else if (ch === "}") depth--;
    }
    end = i;
    if (started && depth <= 0) break;
    if (i - startLine > 300) break; // safety cap
  }
  return end;
}

// Extract a symbol body starting at `startLine` using indentation (Python)
function extractByIndent(lines, startLine) {
  const baseIndent = lines[startLine].match(/^\s*/)[0].length;
  let end = startLine;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") { end = i; continue; }
    const indent = lines[i].match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    end = i;
    if (i - startLine > 300) break;
  }
  return end;
}

function chunkFile(filePath, repoRoot) {
  const lang = EXT_TO_LANG[path.extname(filePath)];
  const relPath = path.relative(repoRoot, filePath);
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const classPatterns = CLASS_PATTERNS[lang];
  const methodPatterns = METHOD_PATTERNS[lang];

  const chunks = [];
  let currentClass = null;
  let i = 0;

  while (i < lines.length) {
    const isClassStart = classPatterns.some((p) => p.test(lines[i]));
    const isMethodStart = !isClassStart && methodPatterns.some((p) => p.test(lines[i]));

    if (isClassStart) {
      // Short "overview" chunk: declaration + immediate fields, up to first method or 20 lines
      const start = i;
      let overviewEnd = start;
      for (let j = start + 1; j < lines.length && j - start < 20; j++) {
        if (methodPatterns.some((p) => p.test(lines[j])) || classPatterns.some((p) => p.test(lines[j]))) break;
        overviewEnd = j;
      }
      const classNameMatch = lines[start].match(/(class|interface|enum|record)\s+(\w+)/);
      currentClass = classNameMatch ? classNameMatch[2] : null;
      const text = lines.slice(start, overviewEnd + 1).join("\n");
      if (text.trim().length > 0) {
        chunks.push({ file: relPath, startLine: start + 1, endLine: overviewEnd + 1, text, symbol: currentClass, kind: "class-overview" });
      }
      i = start + 1; // keep scanning inside the class body for methods
    } else if (isMethodStart) {
      const start = i;
      const end = lang === "python" ? extractByIndent(lines, start) : extractByBraces(lines, start);
      let text = lines.slice(start, end + 1).join("\n");
      if (currentClass) text = `// class ${currentClass}\n` + text;
      if (text.trim().length > 0) {
        chunks.push({ file: relPath, startLine: start + 1, endLine: end + 1, text, symbol: currentClass, kind: "method" });
      }
      i = end + 1;
    } else {
      i++;
    }
  }

  // Fallback: no symbols found (config files, small utility files) — sliding window
  if (chunks.length === 0 && lines.length > 0) {
    const WINDOW = 60, OVERLAP = 10;
    for (let start = 0; start < lines.length; start += WINDOW - OVERLAP) {
      const end = Math.min(start + WINDOW, lines.length);
      const text = lines.slice(start, end).join("\n");
      if (text.trim().length > 0) {
        chunks.push({ file: relPath, startLine: start + 1, endLine: end, text });
      }
      if (end === lines.length) break;
    }
  }

  return chunks;
}

export function chunkRepo(repoRoot) {
  const files = walkFiles(repoRoot);
  const allChunks = [];
  for (const file of files) {
    try {
      allChunks.push(...chunkFile(file, repoRoot));
    } catch (e) {
      console.warn(`Skipping ${file}: ${e.message}`);
    }
  }
  return allChunks;
}
