import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSchedulerConfig } from "../tool-config.mjs";
import {
  getQueuePaths,
  listActiveJobFiles,
  readJob,
  requestWorkerStop
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

function hasFlag(name) {
  return process.argv.includes(name);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStop(pid, lockFile, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid) || !fs.existsSync(lockFile)) {
      return true;
    }

    await wait(250);
  }

  return !isProcessRunning(pid);
}

const schedulerConfig = getSchedulerConfig(toolRoot);
const paths = getQueuePaths(toolRoot, schedulerConfig);
const lock = readLock(paths.lockFile);
const pid = Number(lock?.pid);
const afterCurrent = hasFlag("--after-current") || hasFlag("--graceful");

if (!lock || !Number.isInteger(pid)) {
  if (afterCurrent) {
    const stopFile = requestWorkerStop(paths);
    console.log(JSON.stringify({
      status: "stop-requested",
      mode: "after-current",
      stopFile,
      message: "No running scheduler was found, but a stop marker was written."
    }));
    process.exit(0);
  }

  console.log(JSON.stringify({
    status: "not-running",
    message: "No scheduler lock file was found."
  }));
  process.exit(0);
}

if (!isProcessRunning(pid)) {
  fs.rmSync(paths.lockFile, { force: true });

  if (afterCurrent) {
    const stopFile = requestWorkerStop(paths);
    console.log(JSON.stringify({
      status: "stale-lock-removed-stop-requested",
      mode: "after-current",
      pid,
      stopFile,
      message: "Scheduler was not running; removed stale lock and wrote a stop marker."
    }));
    process.exit(0);
  }

  console.log(JSON.stringify({
    status: "stale-lock-removed",
    pid,
    message: "Scheduler was not running; removed stale lock."
  }));
  process.exit(0);
}

if (afterCurrent) {
  const stopFile = requestWorkerStop(paths);
  const activeJobs = listActiveJobFiles(paths).map(jobPath => readJob(jobPath));
  const runningJobs = activeJobs.filter(job => job.status === "running");

  console.log(JSON.stringify({
    status: "stop-requested",
    mode: "after-current",
    pid,
    runningJobs: runningJobs.map(job => ({
      id: job.id,
      type: job.type,
      label: job.label,
      progress: job.progress
    })),
    stopFile
  }));
  process.exit(0);
}

try {
  process.kill(pid, "SIGTERM");
} catch (error) {
  if (error.code !== "ESRCH") {
    throw error;
  }
}

const stopped = await waitForStop(pid, paths.lockFile);

console.log(JSON.stringify({
  status: stopped ? "stopped" : "stop-requested",
  pid,
  lockFile: paths.lockFile
}));
