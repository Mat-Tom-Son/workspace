import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const target = resolve(rootDir, "dist", "desktop");
const relativeTarget = relative(rootDir, target);

if (relativeTarget !== "dist\\desktop" && relativeTarget !== "dist/desktop") {
  throw new Error(`Refusing to clean unexpected desktop dist path: ${target}`);
}
if (isAbsolute(relativeTarget) || relativeTarget.startsWith("..")) {
  throw new Error(`Refusing to clean path outside repository: ${target}`);
}

await rm(target, { recursive: true, force: true });
