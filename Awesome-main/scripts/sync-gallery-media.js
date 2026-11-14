const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const sourceRoot = path.join(projectRoot, "public", "about-me");
const outputRoot = path.join(projectRoot, "..", "public", "public", "about-me");
const mediaPattern = /\.(jpg|jpeg|png|gif|webp|mp4|webm|ogv)$/i;

function readGalleryFiles(root) {
  const files = new Map();
  if (!fs.existsSync(root)) return files;

  for (const yearFolder of fs.readdirSync(root, { withFileTypes: true })) {
    if (!yearFolder.isDirectory() || !/^\d{4}$/.test(yearFolder.name)) continue;
    const yearPath = path.join(root, yearFolder.name);
    for (const file of fs.readdirSync(yearPath, { withFileTypes: true })) {
      if (!file.isFile() || !mediaPattern.test(file.name)) continue;
      const filePath = path.join(yearPath, file.name);
      const stats = fs.statSync(filePath);
      const relativePath = path.join(yearFolder.name, file.name);
      files.set(relativePath, {
        root,
        path: filePath,
        relativePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs
      });
    }
  }
  return files;
}

function fileDigest(file, digests) {
  if (!digests.has(file.path)) {
    digests.set(file.path, crypto.createHash("sha256").update(fs.readFileSync(file.path)).digest("hex"));
  }
  return digests.get(file.path);
}

function removeGalleryFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
}

function copyGalleryFile(source, targetRoot, relativePath) {
  const targetPath = path.join(targetRoot, relativePath);
  if (source.path === targetPath) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(source.path, targetPath);
}

function compareChanges(source, output) {
  if (source.mtimeMs !== output.mtimeMs) return source.mtimeMs - output.mtimeMs;
  return source.ctimeMs - output.ctimeMs;
}

function syncGalleryMedia() {
  const sourceFiles = readGalleryFiles(sourceRoot);
  const outputFiles = readGalleryFiles(outputRoot);
  const sourceOnly = [...sourceFiles.values()].filter((file) => !outputFiles.has(file.relativePath));
  const outputOnly = [...outputFiles.values()].filter((file) => !sourceFiles.has(file.relativePath));
  const digests = new Map();
  const pairedSource = new Set();
  const pairedOutput = new Set();
  let changed = false;

  for (const sourceFile of sourceOnly) {
    const matchingOutput = outputOnly.find((outputFile) =>
      !pairedOutput.has(outputFile.relativePath)
      && outputFile.size === sourceFile.size
      && fileDigest(outputFile, digests) === fileDigest(sourceFile, digests)
    );
    if (!matchingOutput) continue;

    const renamedFile = compareChanges(sourceFile, matchingOutput) > 0 ? sourceFile : matchingOutput;
    copyGalleryFile(renamedFile, sourceRoot, renamedFile.relativePath);
    copyGalleryFile(renamedFile, outputRoot, renamedFile.relativePath);
    const oldPath = renamedFile === sourceFile ? matchingOutput.relativePath : sourceFile.relativePath;
    removeGalleryFile(sourceRoot, oldPath);
    removeGalleryFile(outputRoot, oldPath);
    pairedSource.add(sourceFile.relativePath);
    pairedOutput.add(matchingOutput.relativePath);
    changed = true;
  }

  for (const file of sourceOnly) {
    if (pairedSource.has(file.relativePath)) continue;
    copyGalleryFile(file, outputRoot, file.relativePath);
    changed = true;
  }

  for (const file of outputOnly) {
    if (pairedOutput.has(file.relativePath)) continue;
    copyGalleryFile(file, sourceRoot, file.relativePath);
    changed = true;
  }

  for (const [relativePath, sourceFile] of sourceFiles) {
    const outputFile = outputFiles.get(relativePath);
    if (!outputFile) continue;
    if (sourceFile.size === outputFile.size && sourceFile.mtimeMs === outputFile.mtimeMs) continue;

    const newerFile = compareChanges(sourceFile, outputFile) > 0 ? sourceFile : outputFile;
    copyGalleryFile(newerFile, newerFile === sourceFile ? outputRoot : sourceRoot, relativePath);
    changed = true;
  }

  return changed;
}

module.exports = syncGalleryMedia;
