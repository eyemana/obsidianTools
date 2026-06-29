import path from "path";
import { fileURLToPath } from "url";

import { enqueueTruthLedgerJob } from "./queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

const vaultRoot = readOption("--vault-root");
const source = readOption("--source") ?? "manual";
const infer = !process.argv.includes("--no-infer");

const result = enqueueTruthLedgerJob({
  toolRoot,
  vaultRoot,
  source,
  infer
});

console.log(JSON.stringify({
  jobId: result.id,
  label: "Truth Ledger Crawl",
  infer,
  jobPath: result.jobPath,
  logPath: result.logPath
}));
