import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyQuotaError,
  decideRoute,
  readAllQuota,
  recordCooldown,
  resolveAgyPool
} from "../plugins/agy/scripts/lib/quota-state.mjs";
import { buildQuotaLines } from "../plugins/agy/scripts/features/setup.mjs";
import { renderStatusReport } from "../plugins/agy/scripts/lib/render.mjs";

function makeTempQuotaDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-test-"));
}

test("resolveAgyPool and classifyQuotaError classify pools and 429/rate-limit errors", () => {
  assert.equal(resolveAgyPool("Gemini 4 Neon (High)"), "gemini");
  assert.equal(resolveAgyPool("Gemini 4 Argon"), "argon");
  assert.equal(resolveAgyPool("Claude Sonnet 4.6"), "3p");
  assert.equal(classifyQuotaError("HTTP 429 Too Many Requests"), true);
  assert.equal(classifyQuotaError("Quota exhausted for 5h window"), true);
  assert.equal(classifyQuotaError("SyntaxError: unexpected token"), false);
});

test("readAllQuota handles live, aging, reset_assumed, and cooldown exhausted states", () => {
  const dir = makeTempQuotaDir();
  const env = { AI_QUOTA_DIR: dir };
  const now = 1_800_000_000;

  try {
    fs.writeFileSync(
      path.join(dir, "claude.json"),
      JSON.stringify({
        schema_version: 1,
        provider: "claude",
        captured_at: now - 60,
        pools: {
          default: {
            "5h": { used_pct: 90, remaining_pct: 10, resets_at: now + 1000 },
            "7d": { used_pct: 20, remaining_pct: 80, resets_at: now + 50000 }
          }
        }
      })
    );
    fs.writeFileSync(
      path.join(dir, "agy.json"),
      JSON.stringify({
        schema_version: 1,
        provider: "agy",
        captured_at: now - 600,
        pools: {
          gemini: {
            "5h": { used_pct: 95, remaining_pct: 5, resets_at: now - 10 },
            "7d": { used_pct: 30, remaining_pct: 70, resets_at: now + 50000 }
          }
        }
      })
    );

    const quota = readAllQuota({ env, nowSec: now });
    assert.equal(quota.claude.pools.default["5h"].state, "live");
    assert.equal(quota.claude.pools.default["5h"].effectiveRemainingPct, 10);
    // Expired resets_at assumes reset rather than blocking
    assert.equal(quota.agy.pools.gemini["5h"].state, "reset_assumed");
    assert.equal(quota.agy.pools.gemini["5h"].effectiveRemainingPct, 100);
    // >300s old but not expired -> aging
    assert.equal(quota.agy.pools.gemini["7d"].state, "aging");
    assert.equal(quota.agy.pools.gemini["7d"].effectiveRemainingPct, 70);

    // Reactive cooldown overrides snapshot
    recordCooldown("agy", "gemini", { reason: "429 rate limit", nowSec: now, env });
    const afterCooldown = readAllQuota({ env, nowSec: now + 10 });
    assert.equal(afterCooldown.agy.pools.gemini["5h"].state, "exhausted");
    assert.equal(afterCooldown.agy.pools.gemini["5h"].effectiveRemainingPct, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("decideRoute routes away from low-headroom or cooled-down pools", () => {
  const dir = makeTempQuotaDir();
  const env = { AI_QUOTA_DIR: dir };
  const now = 1_800_000_000;

  try {
    fs.writeFileSync(
      path.join(dir, "claude.json"),
      JSON.stringify({
        schema_version: 1,
        provider: "claude",
        captured_at: now - 30,
        pools: {
          default: {
            "5h": { used_pct: 95, remaining_pct: 5, resets_at: now + 1800 },
            "7d": { used_pct: 20, remaining_pct: 80, resets_at: now + 86400 }
          }
        }
      })
    );
    fs.writeFileSync(
      path.join(dir, "agy.json"),
      JSON.stringify({
        schema_version: 1,
        provider: "agy",
        captured_at: now - 30,
        pools: {
          gemini: {
            "5h": { used_pct: 18, remaining_pct: 82, resets_at: now + 3600 },
            "7d": { used_pct: 30, remaining_pct: 70, resets_at: now + 86400 }
          }
        }
      })
    );

    const decision = decideRoute({ preferred: "claude", env, nowSec: now });
    assert.deepEqual(decision.selected, { provider: "agy", pool: "gemini" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildQuotaLines and renderStatusReport surface local quota state", () => {
  const dir = makeTempQuotaDir();
  const env = { AI_QUOTA_DIR: dir };
  const now = 1_800_000_000;

  try {
    fs.writeFileSync(
      path.join(dir, "agy.json"),
      JSON.stringify({
        schema_version: 1,
        provider: "agy",
        captured_at: now - 10,
        pools: {
          gemini: {
            "5h": { used_pct: 18, remaining_pct: 82, resets_at: now + 3600 },
            "7d": { used_pct: 41, remaining_pct: 59, resets_at: now + 86400 }
          }
        }
      })
    );

    const lines = buildQuotaLines(process.cwd(), { env, nowSec: now });
    assert.ok(lines.some((l) => l.includes("agy:gemini") && l.includes("82% rem")));

    const quota = readAllQuota({ env, nowSec: now });
    const statusText = renderStatusReport({
      config: { stopReviewGate: false },
      running: [],
      latestFinished: null,
      recent: [],
      needsReview: false,
      quota
    });
    assert.ok(statusText.includes("Quota: agy:gemini 5h:82% rem 7d:59% rem"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
