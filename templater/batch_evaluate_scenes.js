module.exports = async (tp) => {
  const { execFileSync, spawn } = require("child_process");
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

  function loadConfig(toolsRoot) {
    const defaults = {
      scheduler: {
        mode: "manual",
        launchWorkerFromTemplater: true,
        monitorFromTemplater: true,
        queueDir: ".queue",
        statusNoticeIntervalMs: 5000,
        statusNoticeMaxMinutes: 240,
        nodePath: "node"
      }
    };
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const config = parseJsonWithComments(fs.readFileSync(configPath, "utf8"));
    config.scheduler = {
      ...defaults.scheduler,
      ...(config.scheduler ?? {})
    };
    return config;
  }

  function readJsonFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function findJobFile(toolsRoot, scheduler, jobId) {
    const queueDir = scheduler.queueDir || ".queue";
    const queueRoot = path.isAbsolute(queueDir)
      ? queueDir
      : path.join(toolsRoot, queueDir);
    const jobsDir = path.join(queueRoot, "jobs");
    const statuses = ["queued", "running", "succeeded", "failed"];

    for (const status of statuses) {
      const candidate = path.join(jobsDir, `${jobId}.${status}.json`);

      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function formatProgressNotice(job) {
    if (job.status === "queued") {
      return `Batch ${job.id} is queued.`;
    }

    const progress = job.progress ?? {};
    const total = Number(progress.total) || 0;
    const completed = Number(progress.completed) || 0;
    const currentScene = progress.currentScene ?? "waiting for next scene";
    const currentMetric = progress.currentMetric;
    const currentTarget = progress.currentTarget;

    if (job.status === "succeeded") {
      return `Batch ${job.id} complete. ${progress.success ?? completed}/${total || completed} succeeded.`;
    }

    if (job.status === "failed") {
      return `Batch ${job.id} finished with ${progress.failed ?? 0} failures.`;
    }

    const currentLabel = currentMetric && currentTarget
      ? `${currentMetric} / ${currentTarget}`
      : "starting";
    const countLabel = total > 0 ? `${completed}/${total}` : `${completed}`;

    return `Batch ${countLabel}: ${currentLabel} - ${currentScene}`;
  }

  function startProgressMonitor(toolsRoot, scheduler, jobId) {
    if (scheduler.monitorFromTemplater === false) {
      return;
    }

    const intervalMs = Math.max(
      5000,
      Number(scheduler.statusNoticeIntervalMs) || 5000
    );
    const maxMinutes = Math.max(
      1,
      Number(scheduler.statusNoticeMaxMinutes) || 240
    );
    const maxMs = maxMinutes * 60 * 1000;
    const startedAt = Date.now();
    let lastNotice = "";

    const timer = setInterval(() => {
      const jobFile = findJobFile(toolsRoot, scheduler, jobId);

      if (!jobFile) {
        if (Date.now() - startedAt > maxMs) {
          clearInterval(timer);
        }

        return;
      }

      const job = readJsonFile(jobFile);

      if (!job) {
        return;
      }

      const notice = formatProgressNotice(job);

      if (notice && notice !== lastNotice) {
        new Notice(notice);
        lastNotice = notice;
      }

      if (
        job.status === "succeeded" ||
        job.status === "failed" ||
        Date.now() - startedAt > maxMs
      ) {
        clearInterval(timer);
      }
    }, intervalMs);
  }

  const activeFile = app.workspace.getActiveFile();

  if (!activeFile) {
    new Notice("No active file.");
    return "";
  }

  const folderPath = activeFile.parent?.path;

  if (!folderPath) {
    new Notice("Could not determine active folder.");
    return "";
  }

  const files = app.vault
    .getMarkdownFiles()
    .filter(file => file.parent?.path === folderPath)
    .sort((a, b) => a.name.localeCompare(b.name));

  const confirmed = await tp.system.suggester(
    [`Queue evaluation for ${files.length} scenes in ${folderPath}`, "Cancel"],
    ["yes", "no"]
  );

  if (confirmed !== "yes") {
    new Notice("Cancelled.");
    return "";
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const config = loadConfig(toolsRoot);
  const scheduler = config.scheduler ?? {};
  const nodePath = scheduler.nodePath || "node";
  const absoluteFolderPath = path.join(basePath, folderPath);
  const enqueueScript = path.join(toolsRoot, "scheduler", "enqueue-batch.mjs");
  const workerScript = path.join(toolsRoot, "scheduler", "worker.mjs");

  try {
    new Notice("Queueing batch evaluation...");

    const rawOutput = execFileSync(
      nodePath,
      [
        enqueueScript,
        absoluteFolderPath,
        "--vault-root",
        basePath,
        "--source",
        "templater"
      ],
      {
        encoding: "utf8",
        cwd: toolsRoot,
        windowsHide: true
      }
    );

    const outputLine = rawOutput.trim().split(/\r?\n/).filter(Boolean).pop();
    const result = JSON.parse(outputLine);
    startProgressMonitor(toolsRoot, scheduler, result.jobId);

    const shouldLaunchWorker =
      scheduler.mode !== "background" &&
      scheduler.launchWorkerFromTemplater !== false;

    if (shouldLaunchWorker) {
      const child = spawn(
        nodePath,
        [
          workerScript,
          "--drain"
        ],
        {
          cwd: toolsRoot,
          detached: true,
          stdio: "ignore",
          windowsHide: true
        }
      );

      child.unref();
      new Notice(`Queued batch ${result.jobId}. Scheduler started.`);
    } else {
      new Notice(`Queued batch ${result.jobId}. Background scheduler will pick it up.`);
    }
  } catch (error) {
    new Notice("Failed to queue batch evaluation. See developer console.");
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
