import assert from "node:assert/strict";
import test from "node:test";

import { selectAgyModel } from "../plugins/agy/scripts/lib/agy.mjs";

test("selectAgyModel picks by task size when model/tier omitted and respects explicit/env overrides", () => {
  assert.deepEqual(selectAgyModel({ kind: "task", promptLength: 100 }), {
    model: "gemini-4-hydrogen-low",
    tier: "small",
    auto: true
  });
  assert.deepEqual(selectAgyModel({ kind: "review", promptLength: 100 }), {
    model: "gemini-4-hydrogen-medium",
    tier: "medium",
    auto: true
  });
  assert.deepEqual(selectAgyModel({ kind: "handoff", promptLength: 500 }), {
    model: "gemini-4-hydrogen-medium",
    tier: "medium",
    auto: true
  });
  assert.deepEqual(selectAgyModel({ kind: "adversarial-review", promptLength: 100 }), {
    model: "gemini-4-neon-medium",
    tier: "large",
    auto: true
  });
  assert.deepEqual(selectAgyModel({ kind: "task", promptLength: 100, model: "custom-model" }), {
    model: "custom-model",
    tier: "explicit",
    auto: false
  });
  assert.deepEqual(selectAgyModel({ kind: "task", promptLength: 100, tier: "low" }), {
    model: "gemini-3.8-flash-low",
    tier: "low",
    auto: false
  });
  assert.equal(
    selectAgyModel({ kind: "task", promptLength: 100, env: { AGY_MODEL_SMALL: "custom-small" } }).model,
    "custom-small"
  );
});
