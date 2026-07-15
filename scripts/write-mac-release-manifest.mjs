import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const builderDir = join(rootDir, "out", "builder");
const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const version = String(packageJson.version ?? "").trim();
const arch = stringValue(process.env.WORKSPACE_DESKTOP_RELEASE_ARCH) || (process.arch === "x64" ? "x64" : "arm64");
const unsignedSmokeBuild = process.env.WORKSPACE_ALLOW_UNSIGNED_MAC_BUILD === "1";

if (!existsSync(builderDir)) throw new Error("Workspace macOS builder output was not found.");
if (!version) throw new Error("package.json does not declare a Workspace release version.");

const stem = `Workspace-${version}-mac-${arch}`;
const expected = [
  `${stem}.dmg`,
  `${stem}.dmg.blockmap`,
  `${stem}.zip`,
  `${stem}.zip.blockmap`,
  "latest-mac.yml",
];
const available = new Set(await readdir(builderDir));
for (const name of expected) {
  if (!available.has(name)) throw new Error(`Missing Workspace macOS artifact ${name}.`);
}

const artifacts = [];
for (const name of expected.sort((left, right) => left.localeCompare(right))) {
  const buffer = await readFile(join(builderDir, name));
  artifacts.push({
    name,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
}

const manifest = {
  productName: unsignedSmokeBuild ? "Workspace Local Smoke" : packageJson.productName ?? "Workspace",
  version,
  generatedAt: new Date().toISOString(),
  platform: "darwin",
  arch,
  unsignedSmokeBuild,
  buildNodeVersion: process.version,
  feed: {
    owner: stringValue(process.env.WORKSPACE_MAC_RELEASE_OWNER) || "Mat-Tom-Son",
    repo: stringValue(process.env.WORKSPACE_MAC_RELEASE_REPO) || "workspace-mac-releases",
  },
  artifacts,
};

const jsonPath = join(builderDir, "Workspace-mac-release-manifest.json");
const textPath = join(builderDir, "Workspace-mac-release-manifest.txt");
await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(textPath, formatTextManifest(manifest), "utf8");
console.log(`Wrote ${basename(jsonPath)} and ${basename(textPath)}.`);

function formatTextManifest(value) {
  return [
    `${value.productName} macOS release manifest`,
    `Version: ${value.version}`,
    `Generated: ${value.generatedAt}`,
    `Platform: ${value.platform}-${value.arch}`,
    `Feed: ${value.feed.owner}/${value.feed.repo}`,
    `Build Node: ${value.buildNodeVersion}`,
    `Unsigned smoke build: ${value.unsignedSmokeBuild ? "yes" : "no"}`,
    "",
    "Artifacts:",
    ...value.artifacts.map((artifact) => [
      `- ${artifact.name}`,
      `  Bytes: ${artifact.bytes}`,
      `  SHA-256: ${artifact.sha256}`,
    ].join("\n")),
    "",
  ].join("\n");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
