module.exports = async (tp) => {
    const activeFile = app.workspace.getActiveFile();
  
    if (!activeFile) {
      new Notice("No active file.");
      return "";
    }
  
    const folderPath = activeFile.parent?.path;
  
    if (!folderPath) {
      new Notice("Could not determine folder.");
      return "";
    }
  
    const path = await tp.system.prompt(
      `Delete which frontmatter path from all notes in:\n${folderPath}?`,
      ""
    );
  
    if (!path) {
      new Notice("Cancelled.");
      return "";
    }
  
    const confirmed = await tp.system.suggester(
      [
        `Yes, delete "${path}" from all notes in this folder`,
        "Cancel"
      ],
      ["yes", "no"]
    );
  
    if (confirmed !== "yes") {
      new Notice("Cancelled.");
      return "";
    }
  
    const parts = path.split(".").filter(Boolean);
  
    const files = app.vault
      .getMarkdownFiles()
      .filter(file => file.parent?.path === folderPath);
  
    let changed = 0;
  
    for (const file of files) {
      let didChangeThisFile = false;
  
      await app.fileManager.processFrontMatter(file, (fm) => {
        let obj = fm;
  
        for (let i = 0; i < parts.length - 1; i++) {
          obj = obj?.[parts[i]];
  
          if (!obj || typeof obj !== "object") {
            return;
          }
        }
  
        const key = parts[parts.length - 1];
  
        if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
          delete obj[key];
          didChangeThisFile = true;
        }
      });
  
      if (didChangeThisFile) changed++;
    }
  
    new Notice(`Deleted "${path}" from ${changed} file(s) in ${folderPath}.`);
  
    return "";
  };
  