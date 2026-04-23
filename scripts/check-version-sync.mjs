import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const tauriConf = JSON.parse(fs.readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const cargoToml = fs.readFileSync(path.join(repoRoot, "src-tauri", "Cargo.toml"), "utf8");

const cargoMatch = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
if (!cargoMatch) {
  console.error("Could not find Cargo.toml package version");
  process.exit(1);
}

const versions = {
  packageJson: packageJson.version,
  tauriConf: tauriConf.version,
  cargoToml: cargoMatch[1],
};

if (new Set(Object.values(versions)).size !== 1) {
  console.error("Version mismatch detected:", versions);
  process.exit(1);
}

console.log(`Versions are synchronized at ${versions.packageJson}`);
