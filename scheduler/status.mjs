import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSchedulerConfig } from "../tool-config.mjs";
import {
  getQueuePaths,
  readJob,
  readWorkerStop
} from "./queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readLock(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch {
    return null;
  }
}

function listJobFiles(paths) {
  if (!fs.existsSync(paths.jobsDir)) {
    return [];
  }

  return fs.readdirSync(paths.jobsDir)
    .filter(name => name.endsWith(".json"))
    .filter(name => !name.endsWith(".cancel.json"))
    .sort((a, b) => a.localeCompare(b))
    .map(name => path.join(paths.jobsDir, name));
}

function summarizeJob(jobPath) {
  const job = readJob(jobPath);

  return {
    id: job.id,
    type: job.type,
    label: job.label,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    logPath: job.logPath ?? path.join(path.dirname(path.dirname(jobPath)), "logs", `${job.id}.log`)
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
  const currentText = current ? ` - ${current}` : "";

  return `${job.status.padEnd(9)} ${job.label ?? job.type} ${count}${currentText}`;
}

const schedulerConfig = getSchedulerConfig(toolRoot);
const paths = getQueuePaths(toolRoot, schedulerConfig);
const lock = readLock(paths.lockFile);
const pid = Number(lock?.pid);
const running = isProcessRunning(pid);
const stopRequest = readWorkerStop(paths);
const jobs = listJobFiles(paths).map(summarizeJob);
const activeJobs = jobs.filter(job => ["queued", "running"].includes(job.status));
const recentJobs = jobs
  .filter(job => !["queued", "running"].includes(job.status))
  .slice(-5)
  .reverse();
const result = {
  worker: {
    status: running ? "running" : lock ? "stale-lock" : "not-running",
    pid: Number.isInteger(pid) ? pid : null,
    startedAt: lock?.startedAt ?? null,
    lockFile: paths.lockFile
  },
  stopRequest,
  queue: {
    queued: activeJobs.filter(job => job.status === "queued").length,
    running: activeJobs.filter(job => job.status === "running").length,
    active: activeJobs,
    recent: recentJobs
  }
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Worker: ${result.worker.status}${result.worker.pid ? ` pid ${result.worker.pid}` : ""}`);

  if (stopRequest) {
    console.log(`Stop after current: requested at ${stopRequest.requestedAt}`);
  }

  if (activeJobs.length === 0) {
    console.log("Active jobs: none");
  } else {
    console.log("Active jobs:");
    for (const job of activeJobs) {
      console.log(`- ${formatJob(job)}`);
    }
  }

  if (recentJobs.length > 0) {
    console.log("Recent jobs:");
    for (const job of recentJobs) {
      console.log(`- ${formatJob(job)}`);
    }
  }
}
