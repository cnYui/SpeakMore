function createLocalJsonStore({
  fs,
  localDataDir,
  localDataPath,
} = {}) {
  if (!fs || typeof fs.readFileSync !== 'function' || typeof fs.writeFileSync !== 'function') {
    throw new Error('fs is required');
  }
  if (typeof localDataDir !== 'function') {
    throw new Error('localDataDir is required');
  }
  if (typeof localDataPath !== 'function') {
    throw new Error('localDataPath is required');
  }

  function readJsonFile(fileName, fallback) {
    try {
      const filePath = localDataPath(fileName);
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      console.error(`读取本地数据失败: ${fileName}`, error);
      return fallback;
    }
  }

  function writeJsonFile(fileName, value) {
    const dir = localDataDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localDataPath(fileName), JSON.stringify(value, null, 2), 'utf8');
    return value;
  }

  function calculateDirectorySize(targetPath) {
    if (!fs.existsSync(targetPath)) return 0;

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) return stat.size;

    return fs.readdirSync(targetPath, { withFileTypes: true }).reduce((total, entry) => {
      const nextPath = require('path').join(targetPath, entry.name);
      if (entry.isDirectory()) return total + calculateDirectorySize(nextPath);
      return total + fs.statSync(nextPath).size;
    }, 0);
  }

  return {
    readJsonFile,
    writeJsonFile,
    calculateDirectorySize,
  };
}

module.exports = {
  createLocalJsonStore,
};
