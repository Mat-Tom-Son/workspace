import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(rootDir, "desktop", "assets", "workspace-icon-source.svg");
const outDir = join(rootDir, "desktop", "assets");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const run = promisify(execFile);

await mkdir(outDir, { recursive: true });
if (!existsSync(source)) throw new Error(`Icon source not found: ${source}`);

const sourceBytes = await sharp(source, { density: 384 }).png().toBuffer();
await sharp(sourceBytes).resize(1024, 1024).png().toFile(join(outDir, "icon.png"));

const icoPngs = [];
for (const size of sizes) {
  const bytes = await sharp(sourceBytes).resize(size, size).png().toBuffer();
  const pngPath = join(outDir, `icon-${size}.png`);
  await writeFile(pngPath, bytes);
  if ([16, 24, 32, 48, 64, 128, 256].includes(size)) icoPngs.push(pngPath);
}

await writeFile(join(outDir, "icon.ico"), await pngToIco(icoPngs));
if (process.platform === "darwin") await writeIcns(sourceBytes);
console.log(`Generated Workspace desktop icons in ${outDir}`);

async function writeIcns(sourcePng) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "workspace-icon-"));
  const iconset = join(temporaryRoot, "Workspace.iconset");
  const variants = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  try {
    await mkdir(iconset, { recursive: true });
    await Promise.all(variants.map(async ([name, size]) => {
      await sharp(sourcePng).resize(size, size).png().toFile(join(iconset, name));
    }));
    await run("/usr/bin/iconutil", ["--convert", "icns", iconset, "--output", join(outDir, "icon.icns")]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
