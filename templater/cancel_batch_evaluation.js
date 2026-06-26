module.exports = async (tp) => {
  const { execFileSync } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  function stripJsonComments(text) {
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

  function parseJsonWithComments(text) {
    return JSON.parse(stripJsonComments(text));
  }

  function loadSchedulerConfig(toolsRoot) {
    const defaults = {
      queueDir: ".queue",
      nodePath: "node"
    };
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const config = parseJsonWithComments(fs.readFileSync(configPath, "utf8"));
    return {
      ...defaults,
      ...(config.scheduler ?? {})
    };
  }

  function readJsonFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function formatJobOption(job) {
    const progress = job.progress ?? {};
    const completed = Number(progress.completed) || 0;
    const total = Number(progress.total) || 0;
    const progressLabel = total > 0 ? `${completed}/${total}` : `${completed}`;
    const currentScene = progress.currentScene ? ` - ${progress.currentScene}` : "";

    return `${job.status} ${progressLabel}: ${job.id}${currentScene}`;
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const scheduler = loadSchedulerConfig(toolsRoot);
  const queueDir = scheduler.queueDir || ".queue";
  const queueRoot = path.isAbsolute(queueDir)
    ? queueDir
    : path.join(toolsRoot, queueDir);
  const jobsDir = path.join(queueRoot, "jobs");

  if (!fs.existsSync(jobsDir)) {
    new Notice("No scheduler jobs found.");
    return "";
  }

  const jobs = fs.readdirSync(jobsDir)
    .filter(name => name.endsWith(".queued.json") || name.endsWith(".running.json"))
    .sort((a, b) => a.localeCompare(b))
    .map(name => readJsonFile(path.join(jobsDir, name)))
    .filter(Boolean);

  if (jobs.length === 0) {
    new Notice("No queued or running batch jobs.");
    return "";
  }

  const options = jobs.map(formatJobOption);
  const selectedJobId = await tp.system.suggester(
    [...options, "Cancel"],
    [...jobs.map(job => job.id), "cancel"]
  );

  if (!selectedJobId || selectedJobId === "cancel") {
    new Notice("Cancelled.");
    return "";
  }

  const cancelScript = path.join(toolsRoot, "scheduler", "cancel-job.mjs");
  const nodePath = scheduler.nodePath || "node";

  try {
    const rawOutput = execFileSync(
      nodePath,
      [
        cancelScript,
        selectedJobId,
        "--reason",
        "Cancelled from Obsidian."
      ],
      {
        encoding: "utf8",
        cwd: toolsRoot,
        windowsHide: true
      }
    );
    const outputLine = rawOutput.trim().split(/\r?\n/).filter(Boolean).pop();
    const result = JSON.parse(outputLine);

    new Notice(`Cancellation requested for ${result.jobId}.`);
  } catch (error) {
    new Notice("Failed to cancel batch job. See developer console.");
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
