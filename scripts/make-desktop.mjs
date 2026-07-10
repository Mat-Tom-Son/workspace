import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const forgeCli = join(rootDir, "node_modules", "@electron-forge", "cli", "dist", "electron-forge.js");
const args = ["make"];

if (process.platform === "win32") {
  args.push("--platform", "win32", "--arch", process.arch === "arm64" ? "arm64" : "x64", "--targets", "@electron-forge/maker-zip");
}

const child = spawn(process.execPath, [forgeCli, ...args], {
  cwd: rootDir,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
