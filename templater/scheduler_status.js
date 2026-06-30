module.exports = async () => {
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

  function loadSchedulerConfig(toolsRoot) {
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return { nodePath: "node" };
    }

    const config = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
    return {
      nodePath: "node",
      ...(config.scheduler ?? {})
    };
  }

  function formatJob(job) {
    const progress = job.progress ?? {};
    const completed = Number(progress.completed) || 0;
    const total = Number(progress.total) || 0;
    const count = total > 0 ? `${completed}/${total}` : `${completed}`;
    const current = progress.currentScene ??
      progress.currentNote ??
      [progress.currentMetric, progress.currentTarget].filter(Boolean).join(" / ");
    return `${job.label ?? job.type}: ${job.status} ${count}${current ? ` - ${current}` : ""}`;
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const scheduler = loadSchedulerConfig(toolsRoot);
  const nodePath = scheduler.nodePath || "node";
  const statusScript = path.join(toolsRoot, "scheduler", "status.mjs");

  try {
    const rawOutput = execFileSync(
      nodePath,
      [
        statusScript,
        "--json"
      ],
      {
        encoding: "utf8",
        cwd: toolsRoot,
        windowsHide: true
      }
    );
    const status = JSON.parse(rawOutput);
    const active = status.queue?.active ?? [];
    const stopText = status.stopRequest ? " | stop after current requested" : "";

    if (active.length === 0) {
      new Notice(`Scheduler ${status.worker.status}${stopText}. No active jobs.`);
      return "";
    }

    new Notice(`Scheduler ${status.worker.status}${stopText}. ${formatJob(active[0])}`);
  } catch (error) {
    new Notice("Failed to read scheduler status. See developer console.");
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
