import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncSharedLibs } from "./build-cc-for-agy.mjs";

const REPO_SLUG = "Vit129/agy-plugin-cc";

export function packageCcForAgy(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  syncSharedLibs(root);

  const pluginDir = path.join(root, "plugins/cc-for-agy");
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8"));
  const version = pluginManifest.version;
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`Invalid plugins/cc-for-agy/plugin.json version: ${version}`);
  }

  const distDir = path.join(root, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  const zipName = `cc-for-agy-${version}.zip`;
  const zipPath = path.join(distDir, zipName);
  fs.rmSync(zipPath, { force: true });

  execFileSync("zip", ["-rq", zipPath, ".", "-x", "*.DS_Store", "-x", "*/.DS_Store"], { cwd: pluginDir });

  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");

  const marketplaceDir = path.join(root, ".agy-plugin");
  fs.mkdirSync(marketplaceDir, { recursive: true });
  const marketplacePath = path.join(marketplaceDir, "marketplace.json");
  const marketplace = {
    name: "agy-plugin-cc",
    owner: {
      name: "Supavit Cho",
      url: "https://github.com/supavit-cho"
    },
    metadata: {
      description: "Claude Code CLI integration for Antigravity (agy)",
      version
    },
    plugins: [
      {
        name: "cc-for-agy",
        description:
          "Antigravity (agy) native plugin to delegate, cold-review, handoff, and quota-route tasks to Claude Code CLI.",
        version,
        author: "Vit129",
        source: {
          url: `https://github.com/${REPO_SLUG}/releases/download/v${version}/${zipName}`,
          sha256
        }
      }
    ]
  };
  fs.writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

  return { version, zipPath, sha256, marketplacePath };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const { zipPath, sha256, marketplacePath } = packageCcForAgy();
  console.log(`zip: ${path.relative(process.cwd(), zipPath)}`);
  console.log(`sha256: ${sha256}`);
  console.log(`marketplace: ${path.relative(process.cwd(), marketplacePath)}`);
}
