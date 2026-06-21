module.exports = async (tp) => {
  const path = await tp.system.prompt("Frontmatter path to delete", "");

  if (!path) {
    new Notice("Cancelled.");
    return "";
  }

  const file = tp.config.target_file;
  const parts = path.split(".").filter(Boolean);

  await app.fileManager.processFrontMatter(file, (fm) => {
    let obj = fm;

    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj?.[parts[i]];
      if (!obj || typeof obj !== "object") return;
    }

    const key = parts[parts.length - 1];

    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      delete obj[key];
    }
  });

  new Notice(`Deleted "${path}" from ${file.basename}.`);
  return "";
};