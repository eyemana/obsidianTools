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
const targetName = process.argv.slice(4).join(" ");

if (!filePath || !metricName || !targetName) {
  console.error("Usage: node evaluate-scene.mjs <file> <metricName> <targetName>");
  process.exit(1);
}

const targetConfigs = {
  Character: {
    key: "characters",
    folder: "Characters",
    label: "character",
    pluralLabel: "characters"
  },
  "Plot Thread": {
    key: "plotThreads",
    folder: "Plot Threads",
    label: "plot thread",
    pluralLabel: "plot threads"
  },
  "Story Engine": {
    key: "storyEngines",
    folder: "Story Engines",
    label: "story engine",
    pluralLabel: "story engines"
  },
  Arc: {
    key: "arcs",
    folder: "Arcs",
    label: "arc",
    pluralLabel: "arcs"
  }
};

function getTargetConfig(targetName) {
  const normalized = targetName.trim();

  if (targetConfigs[normalized]) {
    return targetConfigs[normalized];
  }

  throw new Error(
    `Invalid target "${targetName}". Expected one of: ${Object.keys(targetConfigs).join(", ")}`
  );
}

function isCharacterAwarenessMetric(metricName) {
  return toCamelCase(metricName) === "characterAwareness";
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

  const result = await response.json();

  try {
    return {
      rawResponse: result.response,
      parsedResponse: JSON.parse(result.response)
    };
  } catch {
    throw new Error(`Invalid JSON response: ${result.response}`);
  }
}

function normalizeSubjectRelationshipScoreMap(bucket, expectedNames, label, rawResponse) {
  if (expectedNames.length === 0) {
    return {
      scene: 0,
      sceneRationale: `No ${label}s listed for this scene.`,
      items: {}
    };
  }

  if (!bucket || typeof bucket !== "object") {
    throw new Error(`Invalid ${label} bucket: ${rawResponse}`);
  }

  if (typeof bucket.scene !== "number") {
    throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
  }

  if (typeof bucket.sceneRationale !== "string") {
    throw new Error(`Invalid ${label} scene rationale: ${rawResponse}`);
  }

  const normalized = {
    scene: bucket.scene,
    sceneRationale: bucket.sceneRationale,
    items: {}
  };

  for (const name of expectedNames) {
    const rawValue = bucket[name];

    if (
      rawValue &&
      typeof rawValue === "object" &&
      typeof rawValue.scene === "number"
    ) {
      normalized.items[name] = {
        scene: rawValue.scene,
        sceneRationale:
          typeof rawValue.sceneRationale === "string"
            ? rawValue.sceneRationale
            : ""
      };
    } else {
      normalized.items[name] = {
        scene: 0,
        sceneRationale: `${label} was listed for evaluation, but the model did not return a scene score.`
      };
    }
  }

  return normalized;
}

function normalizeAwarenessMap(scores, plotThreadNames, characterNames) {
  const normalized = {};

  const source =
    scores && typeof scores === "object"
      ? scores
      : {};

  for (const plotThreadName of plotThreadNames) {
    const rawPlotThread = source[plotThreadName];
    const normalizedCharacters = {};

    for (const characterName of characterNames) {
      const rawCharacter =
        rawPlotThread &&
        typeof rawPlotThread === "object"
          ? rawPlotThread[characterName]
          : undefined;

      let delta = 0;
      let rationale =
        "No new character awareness was returned for this plot thread in this scene.";

      if (typeof rawCharacter === "number") {
        delta = rawCharacter;
        rationale = "";
      } else if (
        rawCharacter &&
        typeof rawCharacter === "object" &&
        typeof rawCharacter.delta === "number"
      ) {
        delta = rawCharacter.delta;
        rationale =
          typeof rawCharacter.rationale === "string"
            ? rawCharacter.rationale
            : "";
      }

      normalizedCharacters[characterName] = {
        delta,
        rationale
      };
    }

    normalized[plotThreadName] = normalizedCharacters;
  }

  return normalized;
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);
const pocRoot = findAncestorFolder(filePath, "POC");

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

function buildStandardMetricPrompt(metricName, targetConfig, targetNames, targetDefinitions) {
  const metricDefinition = readDefinition(
    pocRoot,
    "Metrics",
    metricName
  );

  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

${targetConfig.pluralLabel} to score:
${JSON.stringify(targetNames, null, 2)}

You must return one score object for every listed ${targetConfig.label}.
Use EXACTLY the listed names as JSON keys.
Do not omit any listed item.
Do not add unlisted items.
If an item is barely present, still include it with a low score and rationale.

The rationale-related JSON elements are to be supplied by you as a single sentence supporting the associated score value you gave.

Use this definition of ${metricName}:
${metricDefinition}

Use these ${targetConfig.pluralLabel} definitions:
${targetDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "${targetConfig.key}": {
    "scene": number,
    "sceneRationale": string,
    "${targetConfig.label}Name": {
      "scene": number,
      "sceneRationale": string
    }
  }
}
`;
}

async function evaluateStandardMetric(metricName, targetName) {
  const metricKey = toCamelCase(metricName);
  const targetConfig = getTargetConfig(targetName);

  const targetNames = parsed.data[targetConfig.key] ?? [];

  const targetDefinitions = formatDefinitions(
    readDefinitions(
      pocRoot,
      targetConfig.folder,
      targetNames
    )
  );

  let normalizedScores;

  if (targetNames.length === 0) {
    normalizedScores = {
      scene: 0,
      sceneRationale: `No ${targetConfig.pluralLabel} listed for this scene.`,
      items: {}
    };
  } else {
    const prompt = buildStandardMetricPrompt(
      metricName,
      targetConfig,
      targetNames,
      targetDefinitions
    );

    const { rawResponse, parsedResponse: scores } = await fetchJsonFromOllama(prompt);

    normalizedScores = normalizeSubjectRelationshipScoreMap(
      scores[targetConfig.key],
      targetNames,
      targetConfig.label,
      rawResponse
    );
  }

  parsed.data.ai[metricKey] = parsed.data.ai[metricKey] ?? {};

  parsed.data.ai[metricKey][targetConfig.key] = {
    scene: normalizedScores.scene,
    sceneRationale: normalizedScores.sceneRationale
  };

  for (const [name, value] of Object.entries(normalizedScores.items)) {
    parsed.data.ai[metricKey][targetConfig.key][name] = value;
  }

  parsed.data.ai[metricKey].updated = new Date().toISOString();
}

function buildCharacterAwarenessPrompt(characterNames, plotThreadNames, characterDefinitions, plotThreadDefinitions) {
  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Evaluate character awareness of plot threads for this scene.

Characters:
${JSON.stringify(characterNames, null, 2)}

Plot Threads:
${JSON.stringify(plotThreadNames, null, 2)}

Use EXACTLY the listed plot thread names as JSON keys.
Use EXACTLY the listed character names as JSON keys.
Do not shorten names.
Do not use first names.
Do not add unlisted characters or plot threads.
Do not omit listed characters or plot threads.

Character awareness means how much NEW information a character gains during this scene about a plot thread.

Score delta from 0-10.

0 = the character gains no new information about the plot thread in this scene.
1-3 = the character gains minor or indirect information.
4-6 = the character gains meaningful new information.
7-9 = the character gains major new understanding.
10 = the character receives a decisive revelation.

This is a delta, not cumulative awareness.
Do not score scene relevance.
Do not score reader awareness.
Do not score plot importance.
Only score what each character plausibly learns during this scene.
If a character is not present or cannot plausibly learn the information, use delta 0.

Each rationale must be a single sentence supporting the delta.

Use these character definitions:
${characterDefinitions}

Use these plot thread definitions:
${plotThreadDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "plotThreads": {
    "plotThreadName": {
      "characterName": {
        "delta": number,
        "rationale": "string"
      }
    }
  }
}
`;
}

async function evaluateCharacterAwareness(targetName) {
  if (targetName !== "Plot Thread") {
    throw new Error(
      `Character Awareness only supports target "Plot Thread". Received "${targetName}".`
    );
  }

  const characterNames = parsed.data.characters ?? [];
  const plotThreadNames = parsed.data.plotThreads ?? [];

  const characterDefinitions = formatDefinitions(
    readDefinitions(
      pocRoot,
      "Characters",
      characterNames
    )
  );

  const plotThreadDefinitions = formatDefinitions(
    readDefinitions(
      pocRoot,
      "Plot Threads",
      plotThreadNames
    )
  );

  let plotThreads;

  if (characterNames.length === 0 || plotThreadNames.length === 0) {
    plotThreads = normalizeAwarenessMap(
      {},
      plotThreadNames,
      characterNames
    );
  } else {
    const prompt = buildCharacterAwarenessPrompt(
      characterNames,
      plotThreadNames,
      characterDefinitions,
      plotThreadDefinitions
    );

    const { parsedResponse: scores } = await fetchJsonFromOllama(prompt);

    plotThreads = normalizeAwarenessMap(
      scores.plotThreads,
      plotThreadNames,
      characterNames
    );
  }

  parsed.data.ai.characterAwareness = parsed.data.ai.characterAwareness ?? {};
  parsed.data.ai.characterAwareness.plotThreads = plotThreads;
  parsed.data.ai.characterAwareness.updated = new Date().toISOString();
}

if (isCharacterAwarenessMetric(metricName)) {
  await evaluateCharacterAwareness(targetName);
} else {
  await evaluateStandardMetric(metricName, targetName);
}

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
