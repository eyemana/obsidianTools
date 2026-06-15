import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);
const configPath = path.join(toolRoot, "config.local.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node evaluate-scene.mjs <file>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const prompt = `
Return JSON only.

Evaluate the overall narrative tension of this scene on a scale from 1 to 10.

Scene:

${parsed.content}

Required JSON:
{
  "ai_tension": number
}
`;

const response = await fetch(config.ollamaUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: config.model,
    format: "json",
    prompt,
    stream: false
  })
});

const result = await response.json();
const scores = JSON.parse(result.response);

parsed.data.ai_tension = scores.ai_tension;
parsed.data.ai_model = config.model;
parsed.data.ai_updated = new Date().toISOString();

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
