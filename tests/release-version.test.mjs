import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { updateReleaseVersion } from "../scripts/set-release-version.mjs";

test("release metadata updates semver and build surfaces together", (t) => {
  const tempRoot = path.join(process.cwd(), ".tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, "agy-release-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };

  write("package.json", '{"version":"1.5.1"}\n');
  write(".claude-plugin/plugin.json", '{"version":"1.5.1"}\n');
  write(".claude-plugin/marketplace.json", '{"metadata":{"version":"1.5.1"},"plugins":[{"version":"1.5.1"}]}\n');
  write("version.json", '{"version":1,"updated":"2026-01-01"}\n');
  write("plugins/agy/scripts/lib/git-update-check.mjs", "export const CURRENT_VERSION = 1;\n");

  updateReleaseVersion(root, "1.5.2");

  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, "1.5.2");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/plugin.json"))).version, "1.5.2");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/marketplace.json"))).plugins[0].version, "1.5.2");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "version.json"))).version, 2);
  assert.match(fs.readFileSync(path.join(root, "plugins/agy/scripts/lib/git-update-check.mjs"), "utf8"), /CURRENT_VERSION = 2/);
});
