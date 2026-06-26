module.exports = async () => {
  const { spawn } = require("child_process");
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
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return {
        nodePath: "node"
      };
    }

    const config = parseJsonWithComments(fs.readFileSync(configPath, "utf8"));
    return {
      nodePath: "node",
      ...(config.scheduler ?? {})
    };
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const scheduler = loadSchedulerConfig(toolsRoot);
  const nodePath = scheduler.nodePath || "node";
  const workerScript = path.join(toolsRoot, "scheduler", "worker.mjs");

  try {
    const child = spawn(
      nodePath,
      [
        workerScript,
        "--watch"
      ],
      {
        cwd: toolsRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true
      }
    );

    child.unref();
    new Notice("Background scheduler started.");
  } catch (error) {
    new Notice("Failed to start scheduler. See developer console.");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
