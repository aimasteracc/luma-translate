import { mkdir, copyFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(path.join(root, "dist"), { recursive: true });
const target = path.join(root, "dist/luma-translate-0.1.0.zip");
await rm(target, { force: true });
// zip receives an explicit source directory; API credentials only live in browser storage.
execFileSync("zip", ["-qr", target, "."], { cwd: path.join(root, "extension") });
await copyFile(path.join(root, "README.md"), path.join(root, "dist/README.md"));
console.log(target);
