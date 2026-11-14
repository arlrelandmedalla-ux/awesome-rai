const fs = require("node:fs");
const path = require("node:path");

const galleryRoot = path.join(__dirname, "..", "public", "about-me");
const manifestPath = path.join(__dirname, "..", "public", "gallery-manifest.json");
const descriptionsPath = path.join(__dirname, "gallery-descriptions.js");
const indexPath = path.join(__dirname, "..", "index.html");
const galleryStartMarker = "        // AUTO-GALLERY-ITEMS-START";
const galleryEndMarker = "        // AUTO-GALLERY-ITEMS-END";
const mediaPattern = /^(\d+)\.(\d{1,2})_(\d{1,2})\.(jpg|jpeg|png|gif|webp|mp4|webm|ogv)$/i;
const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const existingDescriptions = require(descriptionsPath);
const previousGalleryItems = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : [];
if (!Array.isArray(previousGalleryItems)) {
  throw new Error("The existing gallery manifest must contain an array.");
}
const previousAddedAtByFile = new Map(previousGalleryItems.map((item) => {
  const fileName = typeof item.src === "string" ? item.src.split("/").pop() : "";
  return [`${item.year}/${fileName}`, item.addedAt];
}));

function isValidDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

if (!fs.existsSync(galleryRoot)) {
  throw new Error(`Gallery folder not found: ${galleryRoot}`);
}

const galleryItems = [];
const descriptionsByYear = {};
const yearFolders = fs.readdirSync(galleryRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
  .sort((a, b) => Number(a.name) - Number(b.name));

for (const yearFolder of yearFolders) {
  const year = Number(yearFolder.name);
  const yearPath = path.join(galleryRoot, yearFolder.name);
  const files = fs.readdirSync(yearPath, { withFileTypes: true })
    .filter((entry) => entry.isFile());
  const yearDescriptions = {};

  for (const file of files) {
    if (!/\.(jpg|jpeg|png|gif|webp|mp4|webm|ogv)$/i.test(file.name)) continue;

    const match = file.name.match(mediaPattern);
    if (!match) {
      console.warn(
        `Invalid gallery media filename "${file.name}" in ${yearFolder.name}. `
        + "Ignoring it; use imageNumber.month_day (for example, 1.1_20.jpg or 1.1_20.mp4)."
      );
      continue;
    }

    const imageNumber = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidDate(year, month, day)) {
      console.warn(`Invalid date in gallery image filename "${yearFolder.name}/${file.name}". Ignoring it.`);
      continue;
    }

    const date = `${yearFolder.name}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const displayDate = `${monthNames[month - 1]} ${day}, ${yearFolder.name}`;
    const type = imageExtensions.has(file.name.split(".").pop().toLowerCase()) ? "image" : "video";
    const stats = fs.statSync(path.join(yearPath, file.name));
    const previousAddedAt = previousAddedAtByFile.get(`${yearFolder.name}/${file.name}`);
    const imageDescription = existingDescriptions[yearFolder.name]?.[file.name] || {
      title: type === "image" ? "Gallery Photo" : "Gallery Video",
      description: `A ${type === "image" ? "photo" : "video"} from ${displayDate}.`
    };
    yearDescriptions[file.name] = imageDescription;
    galleryItems.push({
      year: yearFolder.name,
      src: `/about-me/${yearFolder.name}/${file.name}`,
      type,
      addedAt: Number.isFinite(previousAddedAt) ? previousAddedAt : stats.ctimeMs,
      version: `${stats.size}-${Math.trunc(stats.mtimeMs).toString(36)}`,
      title: imageDescription.title,
      description: imageDescription.description,
      date,
      month,
      day,
      imageNumber
    });
  }
  descriptionsByYear[yearFolder.name] = yearDescriptions;
}

galleryItems.sort((a, b) =>
  Number(a.year) - Number(b.year)
  || a.month - b.month
  || a.day - b.day
  || (a.type === b.type ? 0 : a.type === "image" ? -1 : 1)
  || a.addedAt - b.addedAt
  || a.imageNumber - b.imageNumber
  || a.src.localeCompare(b.src)
);

const descriptionsSource = [
  "module.exports = {",
  ...Object.entries(descriptionsByYear).flatMap(([year, images], yearIndex) => [
    `  // ===== ${year} =====`,
    `  ${JSON.stringify(year)}: {`,
    ...Object.entries(images).flatMap(([fileName, description], imageIndex) => [
      `    // Media/file: public/about-me/${year}/${fileName}`,
      `    ${JSON.stringify(fileName)}: ${JSON.stringify(description)}${imageIndex < Object.keys(images).length - 1 ? "," : ""}`
    ]),
    `  }${yearIndex < Object.keys(descriptionsByYear).length - 1 ? "," : ""}`
  ]),
  "};",
  ""
].join("\n");

const galleryGroups = Object.entries(galleryItems.reduce((groups, item) => {
  (groups[item.year] ||= []).push(item);
  return groups;
}, {}));
let generatedItemCount = 0;
const galleryItemsSource = [
  ...galleryGroups.flatMap(([year, items]) => [
    `        // ===== ${year} =====`,
    ...items.flatMap((item) => [
      "        {",
      `          year: ${JSON.stringify(item.year)},`,
      `          src: ${JSON.stringify(item.src)},`,
      `          type: ${JSON.stringify(item.type)},`,
      `          addedAt: ${item.addedAt},`,
      `          version: ${JSON.stringify(item.version)},`,
      `          title: ${JSON.stringify(item.title)},`,
      `          description: ${JSON.stringify(item.description)},`,
      `          date: ${JSON.stringify(item.date)}`,
      `        }${++generatedItemCount < galleryItems.length ? "," : ""}`
    ])
  ]),
  ""
].join("\n");

const indexHtml = fs.readFileSync(indexPath, "utf8");
const startIndex = indexHtml.indexOf(galleryStartMarker);
const endIndex = indexHtml.indexOf(galleryEndMarker);
if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
  throw new Error("Could not find the generated gallery markers in index.html.");
}
const generatedStart = startIndex + galleryStartMarker.length;
const updatedIndexHtml = indexHtml.slice(0, generatedStart)
  + `\n${galleryItemsSource}`
  + indexHtml.slice(endIndex);

function writeIfChanged(filePath, contents) {
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== contents) {
    fs.writeFileSync(filePath, contents);
  }
}

writeIfChanged(descriptionsPath, descriptionsSource);
writeIfChanged(manifestPath, `${JSON.stringify(galleryItems, null, 2)}\n`);
writeIfChanged(indexPath, updatedIndexHtml);
console.log(`Generated gallery manifest with ${galleryItems.length} media item(s).`);
