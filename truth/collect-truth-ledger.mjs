import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import matter from "gray-matter";

import { loadConfig } from "../tool-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(__filename);
const toolRoot = path.resolve(scriptRoot, "..");
const config = loadConfig(toolRoot);

const allowedTruthValues = new Set([
  "true",
  "false",
  "partial",
  "ambiguous",
  "unknown"
]);

const arrayFields = new Set([
  "plotThreads",
  "characters",
  "storyEngines",
  "arcs",
  "locations",
  "subjects",
  "tags"
]);

const fieldAliases = {
  claim: "id",
  claimId: "id",
  claim_id: "id",
  id: "id",
  truth: "truth",
  truthValue: "truth",
  truth_value: "truth",
  subject: "subject",
  statement: "statement",
  text: "statement",
  plotThread: "plotThreads",
  plotThreads: "plotThreads",
  character: "characters",
  characters: "characters",
  storyEngine: "storyEngines",
  storyEngines: "storyEngines",
  arc: "arcs",
  arcs: "arcs",
  location: "locations",
  locations: "locations",
  tag: "tags",
  tags: "tags"
};

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function readOptions(name) {
  const values = [];

  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index++;
    }
  }

  return values;
}

function usage() {
  return [
    "Usage: node truth/collect-truth-ledger.mjs [--vault-root <path>] [--file <path> ...] [--output <path>] [--json] [--infer|--no-infer]",
    "",
    "Collects author-written [!claim] callouts and optional lower-authority inferred claims into the configured truth ledger index."
  ].join("\n");
}

function resolvePath(root, candidate) {
  if (!candidate) {
    return null;
  }

  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(root, candidate);
}

function walkMarkdownFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function stripCalloutPrefix(line) {
  return line.replace(/^>\s?/, "");
}

function normalizeFieldName(name) {
  return fieldAliases[name.trim()] ?? name.trim();
}

function parseListValue(value) {
  return String(value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function assignField(fields, key, value) {
  const normalizedKey = normalizeFieldName(key);

  if (arrayFields.has(normalizedKey)) {
    fields[normalizedKey] = parseListValue(value);
    return normalizedKey;
  }

  fields[normalizedKey] = String(value ?? "").trim();
  return null;
}

function normalizeTruthValue(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  return allowedTruthValues.has(normalized) ? normalized : "";
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isExactExcerpt(excerpt, sourceText) {
  if (!excerpt || !sourceText) {
    return false;
  }

  if (sourceText.includes(excerpt)) {
    return true;
  }

  return normalizeWhitespace(sourceText).includes(normalizeWhitespace(excerpt));
}

function normalizeEvidence(rawEvidence, sourceText) {
  const evidence = [];
  const seen = new Set();
  const items = Array.isArray(rawEvidence) ? rawEvidence : [];

  for (const item of items) {
    const text = typeof item === "string"
      ? item.trim()
      : String(item?.text ?? item?.excerpt ?? "").trim();

    if (!text || seen.has(text) || !isExactExcerpt(text, sourceText)) {
      continue;
    }

    seen.add(text);
    evidence.push(text);

    if (evidence.length >= 3) {
      break;
    }
  }

  return evidence;
}

function lineForExcerpt(sourceText, excerpt) {
  if (!excerpt) {
    return 1;
  }

  const index = sourceText.indexOf(excerpt);

  if (index === -1) {
    return 1;
  }

  return sourceText.slice(0, index).split(/\r?\n/).length;
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "claim";
}

function hashText(value) {
  return crypto
    .createHash("sha1")
    .update(String(value ?? ""))
    .digest("hex")
    .slice(0, 10);
}

function parseClaimBlock(block, filePath, relativePath) {
  const fields = {};
  const statementLines = [];
  let currentListKey = null;

  if (block.title) {
    const [maybeId] = block.title.split(/\s+/);

    if (maybeId) {
      fields.id = maybeId;
    }
  }

  for (const line of block.lines) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);

    if (listMatch && currentListKey) {
      fields[currentListKey].push(listMatch[1].trim());
      continue;
    }

    const fieldMatch = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);

    if (fieldMatch) {
      currentListKey = assignField(fields, fieldMatch[1], fieldMatch[2]);
      continue;
    }

    currentListKey = null;

    if (line.trim()) {
      statementLines.push(line.trim());
    }
  }

  const statement = fields.statement || statementLines.join(" ").trim();
  const truth = normalizeTruthValue(fields.truth);

  return {
    id: fields.id ?? "",
    authority: "author",
    truth,
    subject: fields.subject ?? "",
    statement,
    plotThreads: fields.plotThreads ?? [],
    characters: fields.characters ?? [],
    storyEngines: fields.storyEngines ?? [],
    arcs: fields.arcs ?? [],
    locations: fields.locations ?? [],
    subjects: fields.subjects ?? [],
    tags: fields.tags ?? [],
    source: {
      path: relativePath,
      absolutePath: filePath,
      line: block.line
    }
  };
}

function extractClaimBlocks(filePath, vaultRoot) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const relativePath = path.relative(vaultRoot, filePath);
  const blocks = [];

  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(/^>\s*\[!claim\][+-]?\s*(.*)$/i);

    if (!header) {
      continue;
    }

    const block = {
      title: header[1].trim(),
      line: index + 1,
      lines: []
    };

    let cursor = index + 1;

    while (cursor < lines.length && /^>\s?/.test(lines[cursor])) {
      block.lines.push(stripCalloutPrefix(lines[cursor]));
      cursor++;
    }

    blocks.push(parseClaimBlock(block, filePath, relativePath));
    index = cursor - 1;
  }

  return blocks;
}

function markdownBody(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw).content.trim();
}

async function fetchJsonFromOllama(prompt) {
  const response = await fetch(config.ollamaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      format: "json",
      prompt,
      stream: false,
      options: {
        temperature: 0
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const result = await response.json();

  try {
    return JSON.parse(result.response);
  } catch {
    throw new Error(`Invalid JSON response: ${result.response}`);
  }
}

function buildInferencePrompt(relativePath, content, inferenceConfig) {
  return `
Return JSON only.
Return compact valid JSON.
Do not include markdown.
Do not include trailing commas.

You are collecting lower-authority inferred truth claims from an author's note.
These inferred claims are not authorial canon.
Infer only claims a careful average reader could reasonably believe from this exact note.
Do not invent new story ideas.
Do not add creative suggestions.
Do not infer beyond the supplied note.
Prefer fewer claims over speculative claims.

Return at most ${inferenceConfig.maxClaimsPerNote} claims.

Allowed truth values:
${JSON.stringify([...allowedTruthValues])}

Each evidence item must be an exact excerpt copied from the note.

Note path:
${relativePath}

Note:
${content}

Required JSON:
{
  "claims": [
    {
      "statement": "claim text",
      "truth": "true|false|partial|ambiguous|unknown",
      "subject": "short subject",
      "confidence": number,
      "plotThreads": ["name"],
      "characters": ["name"],
      "storyEngines": ["name"],
      "arcs": ["name"],
      "locations": ["name"],
      "evidence": ["exact excerpt"]
    }
  ]
}
`;
}

function normalizeInferredClaim(rawClaim, filePath, relativePath, content, index) {
  if (!rawClaim || typeof rawClaim !== "object") {
    return null;
  }

  const statement = String(rawClaim.statement ?? "").trim();
  const truth = normalizeTruthValue(rawClaim.truth);
  const confidence = clampNumber(rawClaim.confidence, 0, 10);
  const evidence = normalizeEvidence(rawClaim.evidence, content);

  if (!statement || !truth || evidence.length === 0) {
    return null;
  }

  const subject = String(rawClaim.subject ?? "").trim();
  const line = lineForExcerpt(content, evidence[0]);

  return {
    id: `inferred.${slugify(relativePath)}.${hashText(`${statement}:${index}`)}`,
    authority: "inferred",
    truth,
    subject,
    statement,
    confidence,
    plotThreads: Array.isArray(rawClaim.plotThreads) ? rawClaim.plotThreads.filter(Boolean) : [],
    characters: Array.isArray(rawClaim.characters) ? rawClaim.characters.filter(Boolean) : [],
    storyEngines: Array.isArray(rawClaim.storyEngines) ? rawClaim.storyEngines.filter(Boolean) : [],
    arcs: Array.isArray(rawClaim.arcs) ? rawClaim.arcs.filter(Boolean) : [],
    locations: Array.isArray(rawClaim.locations) ? rawClaim.locations.filter(Boolean) : [],
    subjects: [],
    tags: [],
    evidence,
    source: {
      path: relativePath,
      absolutePath: filePath,
      line
    }
  };
}

async function inferClaimsFromFile(filePath, vaultRoot, inferenceConfig) {
  const content = markdownBody(filePath);

  if (!content) {
    return [];
  }

  const relativePath = path.relative(vaultRoot, filePath);
  const response = await fetchJsonFromOllama(
    buildInferencePrompt(relativePath, content, inferenceConfig)
  );
  const rawClaims = Array.isArray(response.claims) ? response.claims : [];

  return rawClaims
    .map((rawClaim, index) =>
      normalizeInferredClaim(rawClaim, filePath, relativePath, content, index)
    )
    .filter(Boolean)
    .filter(claim => claim.confidence >= inferenceConfig.minConfidence);
}

async function inferClaims(files, vaultRoot, inferenceConfig, warnings) {
  const inferredClaims = [];

  for (const filePath of files) {
    try {
      inferredClaims.push(
        ...(await inferClaimsFromFile(filePath, vaultRoot, inferenceConfig))
      );
    } catch (error) {
      warnings.push(
        `Could not infer claims from ${path.relative(vaultRoot, filePath)}: ${error.message}`
      );
    }
  }

  return inferredClaims.sort(sortClaims);
}

function validateClaims(claims, scannedPaths) {
  const errors = [];
  const warnings = [];
  const seen = new Map();

  for (const scannedPath of scannedPaths) {
    if (!fs.existsSync(scannedPath)) {
      warnings.push(`Configured truth ledger path does not exist: ${scannedPath}`);
    }
  }

  for (const claim of claims) {
    const where = `${claim.source.path}:${claim.source.line}`;

    if (!claim.id) {
      errors.push(`Claim is missing an id at ${where}`);
    } else if (seen.has(claim.id)) {
      errors.push(
        `Duplicate claim id "${claim.id}" at ${where}; first seen at ${seen.get(claim.id)}`
      );
    } else {
      seen.set(claim.id, where);
    }

    if (!claim.truth) {
      errors.push(
        `Claim "${claim.id || "(missing id)"}" has missing or invalid truth value at ${where}. Expected one of: ${[...allowedTruthValues].join(", ")}`
      );
    }

    if (!claim.statement) {
      errors.push(`Claim "${claim.id || "(missing id)"}" is missing statement text at ${where}`);
    }
  }

  return { errors, warnings };
}

function sortClaims(a, b) {
  return (
    a.subject.localeCompare(b.subject) ||
    a.id.localeCompare(b.id) ||
    a.source.path.localeCompare(b.source.path) ||
    a.source.line - b.source.line
  );
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, targetPath);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const truthConfig = config.truthLedger ?? {};
  const vaultRoot = resolvePath(toolRoot, readOption("--vault-root")) ??
    path.resolve(toolRoot, "..");
  const outputPath = resolvePath(
    toolRoot,
    readOption("--output") ?? truthConfig.outputPath ?? ".index/truth-ledger.json"
  );
  const configuredPaths = Array.isArray(truthConfig.paths)
    ? truthConfig.paths
    : [];
  const explicitFiles = [...new Set(
    readOptions("--file")
      .map(filePath => resolvePath(vaultRoot, filePath))
      .filter(Boolean)
      .filter(filePath => filePath.endsWith(".md"))
  )].sort();
  const inferenceConfig = {
    enabled: truthConfig.inference?.enabled !== false,
    maxClaimsPerNote: Math.max(0, Number(truthConfig.inference?.maxClaimsPerNote) || 5),
    minConfidence: clampNumber(truthConfig.inference?.minConfidence, 0, 10, 6)
  };

  if (process.argv.includes("--infer")) {
    inferenceConfig.enabled = true;
  }

  if (process.argv.includes("--no-infer")) {
    inferenceConfig.enabled = false;
  }

  const scanRoots = configuredPaths.map(scanPath => resolvePath(vaultRoot, scanPath));
  const files = explicitFiles.length > 0
    ? explicitFiles
    : [...new Set(scanRoots.flatMap(walkMarkdownFiles))].sort();
  const claims = files
    .flatMap(filePath => extractClaimBlocks(filePath, vaultRoot))
    .sort(sortClaims);
  const { errors, warnings } = validateClaims(
    claims,
    explicitFiles.length > 0 ? explicitFiles : scanRoots
  );
  const inferredClaims = errors.length === 0 && inferenceConfig.enabled
    ? await inferClaims(files, vaultRoot, inferenceConfig, warnings)
    : [];
  const index = {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    outputPath,
    claimCount: claims.length,
    inferredClaimCount: inferredClaims.length,
    claims,
    inferredClaims,
    warnings,
    errors
  };

  if (errors.length > 0) {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(index, null, 2));
    } else {
      console.error(`Truth ledger validation failed with ${errors.length} error(s):`);
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    }

    process.exitCode = 1;
    return;
  }

  writeJsonAtomic(outputPath, index);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(index, null, 2));
  } else {
    for (const warning of warnings) {
      console.warn(`Warning: ${warning}`);
    }

    console.log(`Wrote ${claims.length} claim(s) to ${outputPath}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
