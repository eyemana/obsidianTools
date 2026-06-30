import crypto from "crypto";
import fs from "fs";
import path from "path";

import { getSchedulerConfig } from "../tool-config.mjs";

export function getQueuePaths(toolRoot, schedulerConfig = getSchedulerConfig(toolRoot)) {
  const queueRoot = path.isAbsolute(schedulerConfig.queueDir)
    ? schedulerConfig.queueDir
    : path.join(toolRoot, schedulerConfig.queueDir);

  return {
    queueRoot,
    jobsDir: path.join(queueRoot, "jobs"),
    logsDir: path.join(queueRoot, "logs"),
    lockFile: path.join(queueRoot, "worker.lock"),
    stopFile: path.join(queueRoot, "worker.stop")
  };
}

export function getCancelMarkerPath(paths, jobId) {
  return path.join(paths.jobsDir, `${jobId}.cancel`);
}

export function ensureQueueDirs(paths) {
  fs.mkdirSync(paths.jobsDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
}

export function requestWorkerStop(paths, reason = "Stop requested after current job.") {
  fs.mkdirSync(paths.queueRoot, { recursive: true });

  writeJsonAtomic(paths.stopFile, {
    reason,
    requestedAt: new Date().toISOString()
  });

  return paths.stopFile;
}

export function clearWorkerStop(paths) {
  fs.rmSync(paths.stopFile, { force: true });
}

export function isWorkerStopRequested(paths) {
  return fs.existsSync(paths.stopFile);
}

export function readWorkerStop(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.stopFile, "utf8"));
  } catch {
    return null;
  }
}

export function normalizeEvaluations(evaluations) {
  if (!Array.isArray(evaluations)) {
    return [];
  }

  return evaluations
    .filter((entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string"
    )
    .map(([metric, target]) => [metric, target]);
}

function makeJobId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${timestamp}-${suffix}`;
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function enqueueEvaluateScenesJob({
  toolRoot,
  scenesFolder,
  sceneFiles,
  vaultRoot,
  source = "manual",
  evaluations,
  label = "Full Scene Evaluation"
}) {
  const schedulerConfig = getSchedulerConfig(toolRoot);
  const paths = getQueuePaths(toolRoot, schedulerConfig);
  ensureQueueDirs(paths);

  const now = new Date().toISOString();
  const id = makeJobId();
  const normalizedEvaluations = normalizeEvaluations(
    evaluations ?? schedulerConfig.evaluations
  );

  if (normalizedEvaluations.length === 0) {
    throw new Error("No scheduler evaluations are configured.");
  }

  const job = {
    version: 1,
    id,
    type: "evaluate-scenes",
    status: "queued",
    label,
    createdAt: now,
    updatedAt: now,
    source,
    scenesFolder: path.resolve(scenesFolder),
    sceneFiles: Array.isArray(sceneFiles)
      ? sceneFiles.map((filePath) => path.resolve(filePath))
      : undefined,
    vaultRoot: vaultRoot ? path.resolve(vaultRoot) : undefined,
    evaluations: normalizedEvaluations
  };

  const jobPath = path.join(paths.jobsDir, `${id}.queued.json`);
  writeJsonAtomic(jobPath, job);

  return {
    id,
    jobPath,
    logPath: path.join(paths.logsDir, `${id}.log`)
  };
}

export function enqueueTruthLedgerJob({
  toolRoot,
  vaultRoot,
  source = "manual",
  label = "Truth Ledger Crawl",
  infer = true
}) {
  const schedulerConfig = getSchedulerConfig(toolRoot);
  const paths = getQueuePaths(toolRoot, schedulerConfig);
  ensureQueueDirs(paths);

  const now = new Date().toISOString();
  const id = makeJobId();
  const job = {
    version: 1,
    id,
    type: "truth-ledger",
    status: "queued",
    label,
    createdAt: now,
    updatedAt: now,
    source,
    vaultRoot: vaultRoot ? path.resolve(vaultRoot) : path.resolve(toolRoot, ".."),
    infer
  };

  const jobPath = path.join(paths.jobsDir, `${id}.queued.json`);
  writeJsonAtomic(jobPath, job);

  return {
    id,
    jobPath,
    logPath: path.join(paths.logsDir, `${id}.log`)
  };
}

export function enqueueChronologyIndexJob({
  toolRoot,
  vaultRoot,
  paths: configuredPaths,
  source = "manual",
  label = "Chronology Index"
}) {
  const schedulerConfig = getSchedulerConfig(toolRoot);
  const paths = getQueuePaths(toolRoot, schedulerConfig);
  ensureQueueDirs(paths);

  const now = new Date().toISOString();
  const id = makeJobId();
  const job = {
    version: 1,
    id,
    type: "chronology-index",
    status: "queued",
    label,
    createdAt: now,
    updatedAt: now,
    source,
    vaultRoot: vaultRoot ? path.resolve(vaultRoot) : path.resolve(toolRoot, ".."),
    paths: Array.isArray(configuredPaths)
      ? configuredPaths.filter(Boolean)
      : undefined
  };

  const jobPath = path.join(paths.jobsDir, `${id}.queued.json`);
  writeJsonAtomic(jobPath, job);

  return {
    id,
    jobPath,
    logPath: path.join(paths.logsDir, `${id}.log`)
  };
}

export function readJob(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJob(filePath, job) {
  writeJsonAtomic(filePath, job);
}

export function listQueuedJobFiles(paths) {
  if (!fs.existsSync(paths.jobsDir)) {
    return [];
  }

  return fs.readdirSync(paths.jobsDir)
    .filter((name) => name.endsWith(".queued.json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(paths.jobsDir, name));
}

export function listActiveJobFiles(paths) {
  if (!fs.existsSync(paths.jobsDir)) {
    return [];
  }

  return fs.readdirSync(paths.jobsDir)
    .filter((name) => name.endsWith(".queued.json") || name.endsWith(".running.json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(paths.jobsDir, name));
}

export function findJobFile(paths, jobId) {
  if (!fs.existsSync(paths.jobsDir)) {
    return null;
  }

  const statuses = ["queued", "running", "succeeded", "failed", "canceled"];

  for (const status of statuses) {
    const candidate = path.join(paths.jobsDir, `${jobId}.${status}.json`);

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isCancelRequested(paths, jobId) {
  return fs.existsSync(getCancelMarkerPath(paths, jobId));
}

export function requestCancelJob(paths, jobId, reason = "Cancellation requested.") {
  ensureQueueDirs(paths);

  const now = new Date().toISOString();
  const markerPath = getCancelMarkerPath(paths, jobId);
  writeJsonAtomic(markerPath, {
    jobId,
    reason,
    requestedAt: now
  });

  const queuedPath = path.join(paths.jobsDir, `${jobId}.queued.json`);

  if (fs.existsSync(queuedPath)) {
    const job = readJob(queuedPath);
    job.status = "canceled";
    job.cancelReason = reason;
    job.canceledAt = now;
    job.updatedAt = now;
    writeJob(queuedPath, job);

    const canceledPath = queuedPath.replace(/\.queued\.json$/, ".canceled.json");
    fs.renameSync(queuedPath, canceledPath);

    return {
      status: "canceled",
      jobPath: canceledPath,
      markerPath
    };
  }

  const jobPath = findJobFile(paths, jobId);

  return {
    status: jobPath ? "cancel-requested" : "not-found",
    jobPath,
    markerPath
  };
}

export function claimJob(jobPath) {
  const runningPath = jobPath.replace(/\.queued\.json$/, ".running.json");

  try {
    fs.renameSync(jobPath, runningPath);
  } catch {
    return null;
  }

  const job = readJob(runningPath);
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.updatedAt = job.startedAt;
  writeJob(runningPath, job);

  return {
    job,
    jobPath: runningPath
  };
}

export function finishJob(jobPath, job, status, extra = {}) {
  const now = new Date().toISOString();
  const finishedJob = {
    ...job,
    ...extra,
    status,
    finishedAt: now,
    updatedAt: now
  };

  writeJob(jobPath, finishedJob);

  const finalPath = jobPath.replace(/\.running\.json$/, `.${status}.json`);
  fs.renameSync(jobPath, finalPath);

  return finalPath;
}
