import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawVersion = process.argv[2];
const githubRepo = process.env.SUPERPOWER_GH_REPO?.trim();
const updaterPubkey = process.env.SUPERPOWER_TAURI_UPDATER_PUBKEY?.trim();

if (!rawVersion) {
  console.error("Usage: node scripts/sync-version.mjs <version-or-tag>");
  process.exit(1);
}

const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semver string: ${version}`);
  process.exit(1);
}

const packageJsonPath = path.join(repoRoot, "package.json");
const tauriConfPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
tauriConf.version = version;

if (githubRepo && updaterPubkey) {
  tauriConf.plugins ??= {};
  tauriConf.plugins.updater = {
    pubkey: updaterPubkey,
    endpoints: [
      `https://github.com/${githubRepo}/releases/latest/download/latest.json`,
      `https://github.com/${githubRepo}/releases/download/beta/latest.json`,
    ],
  };
} else if (tauriConf.plugins?.updater) {
  delete tauriConf.plugins.updater;
  if (Object.keys(tauriConf.plugins).length === 0) {
    delete tauriConf.plugins;
  }
}

fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

const cargoToml = fs.readFileSync(cargoTomlPath, "utf8").replace(
  /^version = ".*"$/m,
  `version = "${version}"`,
);
fs.writeFileSync(cargoTomlPath, cargoToml);

console.log(`Synchronized app version to ${version}`);
