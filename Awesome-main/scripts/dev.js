const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const galleryRoot = path.join(root, "public", "about-me");
const generatorPath = path.join(__dirname, "generate-gallery-manifest.js");
const mediaPattern = /\.(jpg|jpeg|png|gif|webp|mp4|webm|ogv)$/i;

const envFile = [path.join(root, ".env"), path.join(root, "..", ".env")]
  .find((filePath) => fs.existsSync(filePath));
if (envFile) {
  if (typeof process.loadEnvFile !== "function") {
    console.error("Loading .env files requires Node.js 20.12 or newer.");
    process.exit(1);
  }
  try {
    process.loadEnvFile(envFile);
    console.log(`Loaded local environment from ${path.relative(root, envFile)}.`);
  } catch (error) {
    console.error(`Could not load ${path.relative(root, envFile)}.`, error);
    process.exit(1);
  }
}

function getGallerySignature() {
  if (!fs.existsSync(galleryRoot)) return "";

  const entries = [];
  for (const yearFolder of fs.readdirSync(galleryRoot, { withFileTypes: true })) {
    if (!yearFolder.isDirectory() || !/^\d{4}$/.test(yearFolder.name)) continue;

    const yearPath = path.join(galleryRoot, yearFolder.name);
    entries.push(`${yearFolder.name}/`);
    for (const file of fs.readdirSync(yearPath, { withFileTypes: true })) {
      if (!file.isFile() || !mediaPattern.test(file.name)) continue;
      const filePath = path.join(yearPath, file.name);
      const stats = fs.statSync(filePath);
      entries.push(`${yearFolder.name}/${file.name}:${stats.size}:${stats.mtimeMs}`);
    }
  }
  return entries.sort().join("|");
}

function regenerateGallery() {
  const result = spawnSync(process.execPath, [generatorPath], { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error("Could not regenerate the gallery manifest.", result.error);
    return false;
  }
  if (result.status !== 0) {
    console.error(`Gallery manifest generation failed with exit code ${result.status}.`);
    return false;
  }
  return true;
}

const server = spawn(process.execPath, [path.join(__dirname, "local-server.js")], {
  cwd: root,
  stdio: "inherit"
});

let lastSignature = getGallerySignature();
let pendingSignature = null;
let debounceTimer = null;

const scanTimer = setInterval(() => {
  const signature = getGallerySignature();
  if (signature === lastSignature || signature === pendingSignature) return;

  pendingSignature = signature;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (regenerateGallery()) lastSignature = pendingSignature;
    pendingSignature = null;
  }, 600);
}, 750);

function stop(signal) {
  clearInterval(scanTimer);
  clearTimeout(debounceTimer);
  if (!server.killed) server.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
server.on("error", (error) => {
  clearInterval(scanTimer);
  console.error("Could not start the local development server.", error);
  process.exitCode = 1;
});
server.on("exit", (code, signal) => {
  clearInterval(scanTimer);
  clearTimeout(debounceTimer);
  if (signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = code || 0;
  }
});

console.log("Watching public/about-me/<year>/ for added, renamed, or updated images and videos.");
