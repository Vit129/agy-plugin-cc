// Run: npm test   (node:test, no dependencies)
// Resolves each host's skill set the way the host does and checks it, so a
// skill edited under plugins/agy/skills/ is known to reach both hosts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const PLUGIN = path.resolve("plugins/agy");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(PLUGIN, relative), "utf8"));
const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

// Both hosts: path must start with ./, contain no .., and exist under the plugin root.
function checkPath(p) {
  assert.ok(p.startsWith("./"), `${p} must start with ./`);
  assert.ok(!p.split("/").includes(".."), `${p} must not contain ..`);
  assert.ok(fs.statSync(path.join(PLUGIN, p)).isDirectory(), `${p} must be a directory`);
}

function skillsIn(dir) {
  return fs
    .readdirSync(path.join(PLUGIN, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(PLUGIN, dir, entry.name, "SKILL.md")))
    .map((entry) => {
      const text = fs.readFileSync(path.join(PLUGIN, dir, entry.name, "SKILL.md"), "utf8");
      const name = text.match(/^---\n[\s\S]*?^name:\s*(\S+)/m)?.[1];
      assert.ok(name, `${dir}/${entry.name}/SKILL.md needs a name in its frontmatter`);
      assert.match(text, /^description:\s*\S/m, `${dir}/${entry.name}/SKILL.md needs a description`);
      return name;
    });
}

function hostSkills(dirs) {
  const names = dirs.flatMap(skillsIn);
  const dupes = names.filter((name, i) => names.indexOf(name) !== i);
  assert.deepEqual(dupes, [], `duplicate skill names for one host: ${dupes.join(", ")}`);
  return new Set(names);
}

const shared = skillsIn("skills");

test("Claude Code: default skills/ plus manifest paths (which add to the default)", () => {
  const extra = asList(readJson(".claude-plugin/plugin.json").skills);
  extra.forEach(checkPath);
  const names = hostSkills(["./skills/", ...extra.filter((p) => path.normalize(p) !== "skills/")]);
  for (const name of [...shared, "agy-cli-runtime", "agy-result-handling"]) assert.ok(names.has(name), name);
  assert.ok(!names.has("agy"), "the Codex `agy` skill must not load in Claude (clashes with /agy:agy)");
});

test("Codex: manifest skills list replaces the default, so it must list skills/ itself", () => {
  const dirs = asList(readJson(".codex-plugin/plugin.json").skills);
  dirs.forEach(checkPath);
  assert.ok(dirs.some((p) => path.normalize(p) === "skills/"), "Codex manifest must list ./skills/");
  const names = hostSkills(dirs);
  for (const name of [...shared, "agy", "agy-cli-runtime"]) assert.ok(names.has(name), name);
});

test("agents only reference skills Claude loads", () => {
  const claude = hostSkills(["./skills/", ...asList(readJson(".claude-plugin/plugin.json").skills)]);
  for (const file of fs.readdirSync(path.join(PLUGIN, "agents"))) {
    const text = fs.readFileSync(path.join(PLUGIN, "agents", file), "utf8");
    const listed = text.match(/^skills:\n((?:\s+- .+\n)+)/m)?.[1] ?? "";
    for (const name of listed.match(/- (\S+)/g)?.map((m) => m.slice(2)) ?? []) {
      assert.ok(claude.has(name), `${file} lists skill ${name}, which Claude does not load`);
    }
  }
});
