module.exports = async (tp) => {
    const file = tp.config.target_file;

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
        delete frontmatter.ai;
    });

    return "";
};
