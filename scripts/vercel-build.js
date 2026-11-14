const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "Awesome-main");
const outputRoot = path.join(root, "public");
const syncGalleryMedia = require(path.join(siteRoot, "scripts", "sync-gallery-media.js"));

syncGalleryMedia();
execFileSync(
  process.execPath,
  [path.join(siteRoot, "scripts", "generate-gallery-manifest.js")],
  { cwd: siteRoot, stdio: "inherit" }
);

fs.mkdirSync(outputRoot, { recursive: true });
for (const file of ["index.html", "company-profile.html"]) {
  fs.copyFileSync(path.join(siteRoot, file), path.join(outputRoot, file));
}
fs.cpSync(path.join(siteRoot, "public"), path.join(outputRoot, "public"), {
  recursive: true,
  force: true
});

console.log("Prepared Vercel static output in public/.");
