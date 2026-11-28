import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SHARED_LIB_FILES = ["quota-route.mjs", "quota-state.mjs"];

export function syncSharedLibs(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const srcDir = path.join(root, "plugins/agy/scripts/lib");
  const destDir = path.join(root, "plugins/cc-for-agy/scripts/lib");
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const file of SHARED_LIB_FILES) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    fs.copyFileSync(src, dest);
    copied.push(dest);
  }
  return copied;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const copied = syncSharedLibs();
  for (const file of copied) {
    console.log(`synced ${path.relative(process.cwd(), file)}`);
  }
}
