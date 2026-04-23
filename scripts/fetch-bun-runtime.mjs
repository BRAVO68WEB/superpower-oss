import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const platform = args.get("--platform");
const version = args.get("--version");

if (!platform || !version) {
  console.error("Usage: node scripts/fetch-bun-runtime.mjs --platform <bun-target> --version <bun-version>");
  process.exit(1);
}

const archiveName = `${platform}.zip`;
const downloadUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${archiveName}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "superpower-bun-"));
const archivePath = path.join(tempDir, archiveName);
const extractDir = path.join(tempDir, "extract");
fs.mkdirSync(extractDir, { recursive: true });

console.log(`Downloading ${downloadUrl}`);
const response = await fetch(downloadUrl);
if (!response.ok) {
  throw new Error(`Failed to download Bun runtime: ${response.status} ${response.statusText}`);
}
fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
execFileSync("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "inherit" });

const binaryName = platform.startsWith("bun-windows") ? "bun.exe" : "bun";
const extractedBinary = findFile(extractDir, binaryName);
if (!extractedBinary) {
  throw new Error(`Could not locate ${binaryName} inside ${archiveName}`);
}

const outputDir = path.join(repoRoot, "src-tauri", "resources", "bun");
fs.mkdirSync(outputDir, { recursive: true });
const outputName = platform.startsWith("bun-windows") ? `${platform}.exe` : platform;
const outputPath = path.join(outputDir, outputName);
fs.copyFileSync(extractedBinary, outputPath);
if (!platform.startsWith("bun-windows")) {
  fs.chmodSync(outputPath, 0o755);
}

console.log(`Staged ${outputPath}`);

function findFile(dir, fileName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nested = findFile(entryPath, fileName);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}
