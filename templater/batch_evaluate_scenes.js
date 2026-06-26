module.exports = async (tp) => {
  const { execFileSync } = require("child_process");
  const path = require("path");

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

  const confirmed = await tp.system.suggester(
    [`Evaluate all scenes in ${folderPath}`, "Cancel"],
    ["yes", "no"]
  );

  if (confirmed !== "yes") {
    new Notice("Cancelled.");
    return "";
  }

  const basePath = app.vault.adapter.getBasePath();

  const evaluators = [
    {
      name: "Tension",
      script: path.join(basePath, "obsidianTools", "scripts", "evaluate-scene-tension.sh")
    },
    {
      name: "Relevance",
      script: path.join(basePath, "obsidianTools", "scripts", "evaluate-scene-relevance.sh")
    },
    {
      name: "Resolution",
      script: path.join(basePath, "obsidianTools", "scripts", "evaluate-scene-resolution.sh")
    },
    {
      name: "Character Awareness",
      script: path.join(basePath, "obsidianTools", "scripts", "evaluate-scene-character-awareness.sh")
    }

  ];

  const files = app.vault
    .getMarkdownFiles()
    .filter(file => file.parent?.path === folderPath)
    .sort((a, b) => a.name.localeCompare(b.name));

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const absoluteFilePath = path.join(basePath, file.path);

    for (const evaluator of evaluators) {
      try {
        new Notice(`Evaluating ${file.name}: ${evaluator.name}`);

        execFileSync(
          evaluator.script,
          [absoluteFilePath],
          {
            encoding: "utf8",
            cwd: basePath
          }
        );

        success++;
      } catch (error) {
        failed++;
        console.error(`Failed: ${file.path} / ${evaluator.name}`);
        console.error(error.stdout?.toString() || "");
        console.error(error.stderr?.toString() || error.message);
      }
    }
  }

  new Notice(`Batch complete. ${success} succeeded, ${failed} failed.`);

  return "";
};