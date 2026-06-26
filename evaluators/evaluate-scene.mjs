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
import { loadConfig } from "../tool-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const evaluatorRoot = path.dirname(__filename);
const toolRoot = path.join(evaluatorRoot, "..");
const config = loadConfig(toolRoot);

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

function isReaderAwarenessMetric(metricName) {
  return toCamelCase(metricName) === "readerAwareness";
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

  const normalized = {
    scene: 0,
    sceneRationale: "",
    items: {}
  };

  const returnedItemScores = [];

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
      returnedItemScores.push(rawValue.scene);
    } else {
      normalized.items[name] = {
        scene: 0,
        sceneRationale: `${label} was listed for evaluation, but the model did not return a scene score.`
      };
    }
  }

  if (typeof bucket.scene === "number") {
    normalized.scene = bucket.scene;
  } else if (returnedItemScores.length > 0) {
    const sum = returnedItemScores.reduce((total, score) => total + score, 0);
    normalized.scene = Math.round(sum / returnedItemScores.length);
  } else {
    throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
  }

  if (typeof bucket.sceneRationale === "string") {
    normalized.sceneRationale = bucket.sceneRationale;
  } else if (returnedItemScores.length > 0) {
    normalized.sceneRationale =
      `Aggregate ${label} score derived from returned item scores.`;
  } else {
    throw new Error(`Invalid ${label} scene rationale: ${rawResponse}`);
  }

  return normalized;
}

function normalizeCharacterAwarenessMap(scores, plotThreadNames, characterNames) {
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

function normalizeReaderAwarenessMap(scores, targetNames, label) {
  const normalized = {};
  const source =
    scores && typeof scores === "object"
      ? scores
      : {};

  for (const targetName of targetNames) {
    const rawTarget = source[targetName];

    let delta = 0;
    let rationale =
      `No new reader awareness was returned for this ${label} in this scene.`;

    if (typeof rawTarget === "number") {
      delta = rawTarget;
      rationale = "";
    } else if (
      rawTarget &&
      typeof rawTarget === "object" &&
      typeof rawTarget.delta === "number"
    ) {
      delta = rawTarget.delta;
      rationale =
        typeof rawTarget.rationale === "string"
          ? rawTarget.rationale
          : "";
    }

    normalized[targetName] = {
      delta,
      rationale
    };
  }

  return normalized;
}

function writeFileAtomic(targetPath, content) {
  const directory = path.dirname(targetPath);
  const basename = path.basename(targetPath);
  const tempPath = path.join(
    directory,
    `.${basename}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, targetPath);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);
const pocRoot = findAncestorFolder(filePath, "POC");

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

function numericFrontmatter(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getStoryOrder(scene) {
  const chapterOrder = numericFrontmatter(scene.data.chapter_order) ??
    numericFrontmatter(scene.data.chapter);
  const sceneOrder = numericFrontmatter(scene.data.scene_order);

  if (chapterOrder === null || sceneOrder === null) {
    return null;
  }

  return {
    chapterOrder,
    sceneOrder
  };
}

function compareStoryOrder(a, b) {
  if (a.storyOrder && b.storyOrder) {
    if (a.storyOrder.chapterOrder !== b.storyOrder.chapterOrder) {
      return a.storyOrder.chapterOrder - b.storyOrder.chapterOrder;
    }

    if (a.storyOrder.sceneOrder !== b.storyOrder.sceneOrder) {
      return a.storyOrder.sceneOrder - b.storyOrder.sceneOrder;
    }
  } else if (a.storyOrder) {
    return -1;
  } else if (b.storyOrder) {
    return 1;
  }

  return a.fileName.localeCompare(b.fileName);
}

function isPriorStoryScene(scene, currentOrder, currentName) {
  if (currentOrder === null) {
    return scene.fileName.localeCompare(currentName) < 0;
  }

  if (scene.storyOrder === null) {
    return false;
  }

  if (scene.storyOrder.chapterOrder !== currentOrder.chapterOrder) {
    return scene.storyOrder.chapterOrder < currentOrder.chapterOrder;
  }

  return scene.storyOrder.sceneOrder < currentOrder.sceneOrder;
}

function listPriorScenes(currentFilePath, currentScene) {
  const scenesFolder = path.dirname(currentFilePath);
  const currentOrder = getStoryOrder(currentScene);
  const currentName = path.basename(currentFilePath);

  return fs.readdirSync(scenesFolder, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .filter(entry => entry.name.endsWith(".md"))
    .filter(entry => entry.name !== currentName)
    .map(entry => {
      const scenePath = path.join(scenesFolder, entry.name);
      const scene = matter(fs.readFileSync(scenePath, "utf8"));

      return {
        fileName: entry.name,
        name: scene.data.name ?? path.basename(entry.name, ".md"),
        storyOrder: getStoryOrder(scene),
        readerKnowledge: scene.data.reader_knowledge ?? "",
        characters: scene.data.characters ?? [],
        plotThreads: scene.data.plotThreads ?? [],
        arcs: scene.data.arcs ?? [],
        content: scene.content.trim()
      };
    })
    .filter(scene => isPriorStoryScene(scene, currentOrder, currentName))
    .sort(compareStoryOrder);
}

function formatPriorSceneContext(scenes) {
  if (scenes.length === 0) {
    return "No prior scene context is available. Treat all reader-facing information in this scene as newly available to the reader.";
  }

  return scenes.map(scene => {
    return `Scene: ${scene.name}
Story order: ${
  scene.storyOrder
    ? `${scene.storyOrder.chapterOrder}.${scene.storyOrder.sceneOrder}`
    : "unknown"
}
Reader knowledge marker: ${scene.readerKnowledge || "unspecified"}
Characters: ${JSON.stringify(scene.characters)}
Plot threads: ${JSON.stringify(scene.plotThreads)}
Arcs: ${JSON.stringify(scene.arcs)}
Text:
${scene.content}`;
  }).join("\n\n---\n\n");
}

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
    plotThreads = normalizeCharacterAwarenessMap(
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

    plotThreads = normalizeCharacterAwarenessMap(
      scores.plotThreads,
      plotThreadNames,
      characterNames
    );
  }

  parsed.data.ai.characterAwareness = parsed.data.ai.characterAwareness ?? {};
  parsed.data.ai.characterAwareness.plotThreads = plotThreads;
  parsed.data.ai.characterAwareness.updated = new Date().toISOString();
}

function getReaderAwarenessGuidance(targetConfig) {
  if (targetConfig.key === "characters") {
    return {
      subject: "characters",
      meaning:
        "Reader awareness means how much this scene increases, refreshes, or reinforces reader-facing awareness of a character, including explicit mention, first introduction, existence, role, relationship to the setting or cast, behavior, habits, traits, goals, stakes, choices, or reputation.",
      low:
        "1-3 = the reader receives minor, indirect, confirmatory, first-contact, or salience-building awareness of the character.",
      medium:
        "4-6 = the reader gains meaningful new information about the character's role, traits, relationships, goals, history, choices, or stakes.",
      high:
        "7-9 = the reader gains major new understanding of the character.",
      decisive:
        "10 = the reader receives a decisive revelation about the character.",
      cautions: [
        "Score what the reader newly learns about the character, not whether the character is important.",
        "The reader can learn about absent characters if the scene reveals meaningful information about them.",
        "Do not infer awareness from the frontmatter list alone; score only what is visible in the prose or reader knowledge marker.",
        "Do not require first contact for a nonzero score; repeated on-page mentions can still earn a low positive delta when they keep the character present in the reader's mind.",
        "If the prose names or clearly identifies the character, this is usually at least delta 1 even when the reader has prior context.",
        "If a mention also establishes or reinforces setting, occupation, relationship, routine, attitude, social role, or a memorable behavioral detail, use delta 2-4 depending on specificity.",
        "Use delta 0 only when the scene gives the reader no practical awareness signal for the character beyond the character being listed in frontmatter."
      ]
    };
  }

  if (targetConfig.key === "arcs") {
    return {
      subject: "arcs",
      meaning:
        "Reader awareness means how much NEW evidence the reader receives during this scene that an arc is progressing, changing direction, deepening, or resolving.",
      low:
        "1-3 = the reader receives minor, indirect, or confirmatory evidence of arc movement.",
      medium:
        "4-6 = the reader receives meaningful evidence of progress, regression, complication, or change in the arc.",
      high:
        "7-9 = the reader receives major evidence of arc movement or a significant turning point.",
      decisive:
        "10 = the reader receives decisive evidence of a major arc breakthrough, reversal, or resolution.",
      cautions: [
        "Score evidence shown to the reader, not author intent that remains invisible on the page.",
        "Do not score whether the arc is important in the story.",
        "If the scene only repeats already-established arc movement, use delta 0 or a low confirmatory score."
      ]
    };
  }

  return {
    subject: "plot threads",
    meaning:
      "Reader awareness means how much NEW information the reader gains during this scene about a plot thread.",
    low:
      "1-3 = the reader gains minor, indirect, or confirmatory information about the plot thread.",
    medium:
      "4-6 = the reader gains meaningful new information or a clearer connection.",
    high:
      "7-9 = the reader gains major new understanding.",
    decisive:
      "10 = the reader receives a decisive revelation about the plot thread.",
    cautions: [
      "Do not score plot importance.",
      "If the scene repeats information the reader already had, use delta 0 or a low confirmatory score."
    ]
  };
}

function buildReaderAwarenessPrompt(targetConfig, targetNames, targetDefinitions, priorSceneContext) {
  const guidance = getReaderAwarenessGuidance(targetConfig);

  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Evaluate reader awareness of ${guidance.subject} for this scene.

${targetConfig.pluralLabel}:
${JSON.stringify(targetNames, null, 2)}

Use EXACTLY the listed ${targetConfig.label} names as JSON keys.
Do not shorten names.
Do not add unlisted ${targetConfig.pluralLabel}.
Do not omit listed ${targetConfig.pluralLabel}.

${guidance.meaning}

Score delta from 0-10.

0 = the reader gains no new awareness for this ${targetConfig.label} in this scene.
${guidance.low}
${guidance.medium}
${guidance.high}
${guidance.decisive}

This is a delta, not cumulative awareness.
Compare this scene to the prior scene context, and score only information newly available to the reader in this scene.
The reader can learn from narration, dramatic irony, scene framing, implications, reveals, and any point-of-view character.
The reader is not limited to what any character knows.
Do not score what characters know; this is reader-facing awareness only.
Do not score scene relevance.
${guidance.cautions.join("\n")}

Each rationale must be a single sentence supporting the delta.

Use these ${targetConfig.pluralLabel} definitions:
${targetDefinitions}

Prior scene context available to the reader:
${priorSceneContext}

Current scene reader knowledge marker:
${parsed.data.reader_knowledge ?? "unspecified"}

Current scene:

${parsed.content}

Required JSON:
{
  "${targetConfig.key}": {
    "${targetConfig.label}Name": {
      "delta": number,
      "rationale": "string"
    }
  }
}
`;
}

async function evaluateReaderAwareness(targetName) {
  const targetConfig = getTargetConfig(targetName);

  if (!["characters", "plotThreads", "arcs"].includes(targetConfig.key)) {
    throw new Error(
      `Reader Awareness only supports targets "Character", "Plot Thread", and "Arc". Received "${targetName}".`
    );
  }

  const targetNames = parsed.data[targetConfig.key] ?? [];

  const targetDefinitions = formatDefinitions(
    readDefinitions(
      pocRoot,
      targetConfig.folder,
      targetNames
    )
  );

  let targetScores;

  if (targetNames.length === 0) {
    targetScores = normalizeReaderAwarenessMap(
      {},
      targetNames,
      targetConfig.label
    );
  } else {
    const priorSceneContext = formatPriorSceneContext(
      listPriorScenes(filePath, parsed)
    );
    const prompt = buildReaderAwarenessPrompt(
      targetConfig,
      targetNames,
      targetDefinitions,
      priorSceneContext
    );

    const { parsedResponse: scores } = await fetchJsonFromOllama(prompt);

    targetScores = normalizeReaderAwarenessMap(
      scores[targetConfig.key],
      targetNames,
      targetConfig.label
    );
  }

  parsed.data.ai.readerAwareness = parsed.data.ai.readerAwareness ?? {};
  parsed.data.ai.readerAwareness[targetConfig.key] = targetScores;
  parsed.data.ai.readerAwareness.updated = new Date().toISOString();
}

if (isCharacterAwarenessMetric(metricName)) {
  await evaluateCharacterAwareness(targetName);
} else if (isReaderAwarenessMetric(metricName)) {
  await evaluateReaderAwareness(targetName);
} else {
  await evaluateStandardMetric(metricName, targetName);
}

const updated = matter.stringify(parsed.content, parsed.data);
writeFileAtomic(filePath, updated);
