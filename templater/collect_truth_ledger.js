module.exports = async () => {
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

    const config = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
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
    const statuses = ["queued", "running", "succeeded", "failed", "canceled"];

    for (const status of statuses) {
      const candidate = path.join(jobsDir, `${jobId}.${status}.json`);

      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function formatProgressNotice(job) {
    const label = job.label ?? "Truth Ledger";

    if (job.status === "queued") {
      return `${label} ${job.id} is queued.`;
    }

    const progress = job.progress ?? {};
    const total = Number(progress.total) || 0;
    const completed = Number(progress.completed) || 0;
    const countLabel = total > 0 ? `${completed}/${total}` : `${completed}`;

    if (job.status === "succeeded") {
      return `${label} ${job.id} complete. ${job.claimCount ?? 0} authored, ${job.inferredClaimCount ?? 0} inferred.`;
    }

    if (job.status === "failed") {
      return `${label} ${job.id} finished with ${progress.failed ?? 0} failures.`;
    }

    return `${label} ${countLabel}: ${progress.currentNote ?? "starting"}`;
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
        job.status === "canceled" ||
        Date.now() - startedAt > maxMs
      ) {
        clearInterval(timer);
      }
    }, intervalMs);
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const config = loadConfig(toolsRoot);
  const scheduler = config.scheduler ?? {};
  const nodePath = scheduler.nodePath || "node";
  const enqueueScript = path.join(toolsRoot, "scheduler", "enqueue-truth-ledger.mjs");
  const workerScript = path.join(toolsRoot, "scheduler", "worker.mjs");

  try {
    new Notice("Queueing Truth Ledger crawl...");

    const rawOutput = execFileSync(
      nodePath,
      [
        enqueueScript,
        "--vault-root",
        basePath,
        "--source",
        "templater"
      ],
      {
        cwd: toolsRoot,
        encoding: "utf8",
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
      new Notice(`Queued Truth Ledger ${result.jobId}. Scheduler started.`);
    } else {
      new Notice(`Queued Truth Ledger ${result.jobId}. Background scheduler will pick it up.`);
    }
  } catch (error) {
    const message = [
      error.stdout?.toString().trim(),
      error.stderr?.toString().trim(),
      error.message
    ].filter(Boolean).join("\n");

    console.error(message);
    new Notice("Truth Ledger crawl failed to queue. See console for details.");
  }
};
