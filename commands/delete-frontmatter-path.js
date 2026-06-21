module.exports = async (tp, path = "ai") => {
    const file = tp.config.target_file;
    const parts = path.split(".").filter(Boolean);
  
    await app.fileManager.processFrontMatter(file, (fm) => {
      let obj = fm;
  
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj?.[parts[i]];
        if (!obj || typeof obj !== "object") return;
      }
  
      delete obj[parts[parts.length - 1]];
    });
  
    return "";
  };
  