import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(rootDir, "desktop", "assets", "workspace-icon-source.svg");
const outDir = join(rootDir, "desktop", "assets");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

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
console.log(`Generated Workspace desktop icons in ${outDir}`);
