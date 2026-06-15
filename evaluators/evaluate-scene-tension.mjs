import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);
const configPath = path.join(toolRoot, "..", "config.local.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node evaluate-scene-tension.mjs <file>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const prompt = `
Return JSON only.

Evaluate narrative tension on a scale from 1 to 10.

Score:
1. Overall scene tension.
2. Character-specific narrative tension for each character listed in frontmatter.

For overal scene tension, the POV tension value carries the most weight.
Characters may be present, absent, referenced, remembered, feared, desired, or influencing the scene indirectly.
Tension scores are from each character's perspective.  A character may be in danger and not know it even though the reader does, or another character does, in which case the endangered character's tension would be low.

Frontmatter characters:
${JSON.stringify(parsed.data.characters ?? [], null, 2)}

Scene:

${parsed.content}

Required JSON:
{
  "scene": number,
  "characters": {
    "CharacterName": number
  }
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

if (typeof scores.scene !== "number") {
  throw new Error(`Invalid scene score: ${result.response}`);
}

if (!scores.characters || typeof scores.characters !== "object") {
  throw new Error(`Invalid character scores: ${result.response}`);
}

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

parsed.data.ai.tension = {
  scene: scores.scene,
  characters: scores.characters,
  updated: new Date().toISOString()
};

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
