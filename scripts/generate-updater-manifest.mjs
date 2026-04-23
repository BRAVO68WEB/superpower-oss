import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const inputDir = args.get("--input-dir");
const outputPath = args.get("--output");

if (!inputDir || !outputPath) {
  console.error("Usage: node scripts/generate-updater-manifest.mjs --input-dir <dir> --output <file>");
  process.exit(1);
}

const manifestPaths = collectJsonFiles(inputDir).filter((filePath) => path.basename(filePath) === "latest.json");
if (manifestPaths.length === 0) {
  console.error(`No latest.json files found under ${inputDir}`);
  process.exit(1);
}

const manifests = manifestPaths.map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")));
const baseManifest = structuredClone(manifests[0]);
baseManifest.platforms = {};

for (const manifest of manifests) {
  if (manifest.version !== baseManifest.version) {
    console.error("Updater manifest versions do not match:", manifest.version, baseManifest.version);
    process.exit(1);
  }

  Object.assign(baseManifest.platforms, manifest.platforms ?? {});
  if (!baseManifest.notes && manifest.notes) {
    baseManifest.notes = manifest.notes;
  }
  if (!baseManifest.pub_date && manifest.pub_date) {
    baseManifest.pub_date = manifest.pub_date;
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(baseManifest, null, 2)}\n`);
console.log(`Wrote merged updater manifest to ${outputPath}`);

function collectJsonFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}
