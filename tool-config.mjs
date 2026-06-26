import fs from "fs";
import path from "path";

export const defaultConfig = {
  ollamaUrl: "http://localhost:11434/api/generate",
  model: "qwen2.5:7b",
  scheduler: {
    mode: "manual",
    queueDir: ".queue",
    throttleMs: 5000,
    pollIntervalMs: 30000,
    launchWorkerFromTemplater: true,
    monitorFromTemplater: true,
    statusNoticeIntervalMs: 5000,
    statusNoticeMaxMinutes: 240,
    nodePath: "node",
    evaluations: [
      ["Relevance", "Character"],
      ["Relevance", "Plot Thread"],
      ["Relevance", "Story Engine"],
      ["Relevance", "Arc"],
      ["Tension", "Character"],
      ["Tension", "Plot Thread"],
      ["Tension", "Story Engine"],
      ["Tension", "Arc"],
      ["Resolution", "Character"],
      ["Resolution", "Plot Thread"],
      ["Resolution", "Story Engine"],
      ["Resolution", "Arc"],
      ["Character Awareness", "Plot Thread"]
    ]
  }
};

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeConfig(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }

      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index++;
      }

      continue;
    }

    if (inString) {
      output += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index++;
      continue;
    }

    output += char;
  }

  return output;
}

export function parseConfigText(text) {
  return JSON.parse(stripJsonComments(text));
}

export function loadConfig(toolRoot) {
  const localPath = path.join(toolRoot, "config.local.json");
  const examplePath = path.join(toolRoot, "config.example.json");
  const configPath = fs.existsSync(localPath) ? localPath : examplePath;

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  const fileConfig = parseConfigText(fs.readFileSync(configPath, "utf8"));
  return mergeConfig(defaultConfig, fileConfig);
}

export function getSchedulerConfig(toolRoot) {
  return loadConfig(toolRoot).scheduler;
}
