import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);

const scenesFolder = process.argv[2];
console.log(`Checking directory: ${scenesFolder}`);

if (!scenesFolder) {
  console.error("Usage: node batch-evaluate-scenes.mjs <scenes-folder>");
  process.exit(1);
}

const markdownFiles = fs.readdirSync(scenesFolder, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .filter(entry => entry.name.endsWith(".md"))
  .map(entry => path.join(scenesFolder, entry.name));

console.log(`Found ${markdownFiles.length} scene files.`);

for (const filePath of markdownFiles) {
  console.log(`\nEvaluating: ${path.basename(filePath)}`);

  try {
    const output = execFileSync(
      "node",
      [
        path.join(toolRoot, "evaluate-scene-tension.mjs"),
        filePath
      ],
      { encoding: "utf8" }
    );

    console.log(output.trim());
  } catch (error) {
    console.error(`Failed: ${filePath}`);
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
  }
}