import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";
import {
  findAncestorFolder,
  readDefinition,
  readDefinitions,
  formatDefinitions,
  toCamelCase
} from "../vault-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);
const configPath = path.join(toolRoot, "..", "config.local.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const filePath = process.argv[2];
const metricName = process.argv[3];

if (!filePath || !metricName) {
  console.error("Usage: node evaluate-scene-metric.mjs <file> <metricName>");
  process.exit(1);
}
const metricKey = toCamelCase(metricName);

function normalizeScoreMap(scores, expectedNames, label, rawResponse) {
  if (!scores || typeof scores !== "object") {
    throw new Error(`Invalid ${label} scores: ${rawResponse}`);
  }

  const normalized = {};

  for (const name of expectedNames) {
    const rawValue = scores[name];

    let score;
    let rationale = "";

    if (typeof rawValue === "number") {
      score = rawValue;
    } else if (
      rawValue &&
      typeof rawValue === "object" &&
      typeof rawValue.score === "number"
    ) {
      score = rawValue.score;
      rationale =
        typeof rawValue.rationale === "string"
          ? rawValue.rationale
          : "";
    } else {
      score = 0;
      rationale = `${label} was listed for evaluation, but the model did not return a score.`;
    }
    normalized[name] = { score, rationale };
  }

  return normalized;
}


const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const pocRoot = findAncestorFolder(filePath, "POC");

const metricDefinition = readDefinition(
  pocRoot,
  "Metrics",
  metricName
);

const characterNames = parsed.data.characters ?? [];

const characterDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Characters",
    characterNames
  )
);

const plotThreadNames = parsed.data.plotThreads ?? [];

const plotThreadDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Plot Threads",
    plotThreadNames
  )
);

const storyEngineNames = parsed.data.storyEngines ?? [];

const storyEngineDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Story Engines",
    storyEngineNames
  )
);

const arcNames = parsed.data.arcs ?? [];

const arcDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Arcs",
    arcNames
  )
);

const prompt = `
Return JSON only.
Characters to score:
${JSON.stringify(characterNames, null, 2)}

Plot Threads to score:
${JSON.stringify(plotThreadNames, null, 2)}

Story Engines to score:
${JSON.stringify(storyEngineNames, null, 2)}

Arcs to score:
${JSON.stringify(arcNames, null, 2)}

You must return one score object for every listed character, plot thread, story engine, and arc.
Use EXACTLY the listed names as JSON keys.
Do not omit any listed item.
Do not add unlisted items.
If an item is barely present, still include it with a low score and rationale.

The rationale-related JSON elements are to be supplied by you as a single entence supporting the associated score value you gave.

Use these character definitions
${characterDefinitions}

Use this definition of ${metricName}:
${metricDefinition}

Use these Plot thread definitions:
${plotThreadDefinitions}

Use these Story Engine definitions:
${storyEngineDefinitions}

Use these Arc definitions:
${arcDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "scene": number,
  "sceneRationale": string,
  "characters": {
    "characterName": {
      "score": number,
      "rationale": string
    }
  },
  "plotThreads": {
    "plotThreadName": {
      "score": number,
      "rationale": string
    }
  },
  "storyEngines": {
    "storyEngineName": {
      "score": number,
      "rationale": string
    }
  },
  "arcs": {
    "arcName": {
      "score": number,
      "rationale": string
    }
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
  throw new Error(`Invalid scene ${metricKey} score: ${result.response}`);
}

if (typeof scores.sceneRationale !== "string") {
  throw new Error(`Invalid scene ${metricKey} rationale: ${result.response}`);
}


if (!scores.arcs || typeof scores.arcs !== "object") {
  throw new Error(`Invalid arc ${metricKey} scores: ${result.response}`);
}
parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

parsed.data.ai[metricKey] = {
  scene: scores.scene,
  sceneRationale: scores.sceneRationale,
  characters: normalizeScoreMap(
    scores.characters,
    characterNames,
    "character",
    result.response
  ),
  plotThreads: normalizeScoreMap(
    scores.plotThreads ?? {},
    plotThreadNames,
    "plot thread",
    result.response
  ),
  storyEngines: normalizeScoreMap(
    scores.storyEngines ?? {},
    storyEngineNames,
    "story engine",
    result.response
  ),
  arcs: normalizeScoreMap(
    scores.arcs ?? {},
    arcNames,
    "arc",
    result.response
  ),
  updated: new Date().toISOString()
};

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
