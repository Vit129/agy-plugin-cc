import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const LIVE_THRESHOLD_SEC = 300;
const DEFAULT_COOLDOWN_SEC = 300;
const QUOTA_ERROR_PATTERN =
  /\b429\b|rate[\s_-]?limit|quota[\s_-]?(exceeded|exhausted|limit)?|usage[\s_-]?limit|exhausted|overloaded/i;

export function resolveQuotaDir(env = process.env) {
  if (env.AI_QUOTA_DIR) return env.AI_QUOTA_DIR;
  const xdg = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(xdg, "ai-quota");
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function resolveAgyPool(modelName = "") {
  const s = String(modelName || "");
  if (/argon/i.test(s)) return "argon";
  if (/(claude|gpt|chatgpt|3p)/i.test(s)) return "3p";
  return "gemini";
}

export function classifyQuotaError(text = "") {
  return QUOTA_ERROR_PATTERN.test(String(text || ""));
}

function evaluateWindow(win, capturedAt, cooldown, nowSec) {
  if (cooldown && cooldown.cooldown_until > nowSec && (!capturedAt || cooldown.recorded_at >= capturedAt)) {
    return {
      state: "exhausted",
      confidence: "high",
      effectiveRemainingPct: 0,
      effectiveUsedPct: 100,
      resetsAt: cooldown.cooldown_until,
      ageSec: capturedAt ? Math.max(0, nowSec - capturedAt) : null
    };
  }
  if (!win || typeof win.remaining_pct !== "number") {
    return {
      state: "unknown",
      confidence: "none",
      effectiveRemainingPct: null,
      effectiveUsedPct: null,
      resetsAt: win?.resets_at ?? null,
      ageSec: capturedAt ? Math.max(0, nowSec - capturedAt) : null
    };
  }
  const ageSec = capturedAt ? Math.max(0, nowSec - capturedAt) : null;
  if (typeof win.resets_at === "number" && nowSec >= win.resets_at) {
    return {
      state: "reset_assumed",
      confidence: "medium",
      effectiveRemainingPct: 100,
      effectiveUsedPct: 0,
      resetsAt: win.resets_at,
      ageSec
    };
  }
  const isLive = ageSec !== null && ageSec <= LIVE_THRESHOLD_SEC;
  return {
    state: isLive ? "live" : "aging",
    confidence: isLive ? "high" : "low-med",
    effectiveRemainingPct: win.remaining_pct,
    effectiveUsedPct: typeof win.used_pct === "number" ? win.used_pct : 100 - win.remaining_pct,
    resetsAt: win.resets_at ?? null,
    ageSec
  };
}

export function readCooldowns(options = {}) {
  const dir = resolveQuotaDir(options.env);
  const raw = readJsonSafe(path.join(dir, "cooldowns.json"));
  return raw && typeof raw === "object" ? raw : {};
}

export function recordCooldown(provider, pool, options = {}) {
  const env = options.env ?? process.env;
  const dir = resolveQuotaDir(env);
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const filePath = path.join(dir, "cooldowns.json");
  const current = readCooldowns({ env });
  const key = `${provider}:${pool}`;
  const cooldownUntil =
    typeof options.resetsAt === "number" && options.resetsAt > nowSec
      ? options.resetsAt
      : nowSec + (options.cooldownSec ?? DEFAULT_COOLDOWN_SEC);

  current[key] = {
    provider,
    pool,
    recorded_at: nowSec,
    cooldown_until: cooldownUntil,
    reason: String(options.reason || "rate limit / quota exhausted").slice(0, 200)
  };
  writeJsonAtomic(filePath, current);
  return current[key];
}

export function readProviderQuota(provider, options = {}) {
  const env = options.env ?? process.env;
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const dir = resolveQuotaDir(env);
  const raw = readJsonSafe(path.join(dir, `${provider}.json`));
  const cooldowns = readCooldowns({ env });

  const poolNames = provider === "claude" ? ["default"] : ["gemini", "argon", "3p"];
  const pools = {};
  for (const pool of poolNames) {
    const rawPool = raw?.pools?.[pool] ?? {};
    const cd = cooldowns[`${provider}:${pool}`] ?? null;
    const w5 = evaluateWindow(rawPool["5h"], raw?.captured_at ?? null, cd, nowSec);
    const w7 = evaluateWindow(rawPool["7d"], raw?.captured_at ?? null, cd, nowSec);
    pools[pool] = { "5h": w5, "7d": w7 };
  }

  return {
    provider,
    available: Boolean(raw),
    capturedAt: raw?.captured_at ?? null,
    activeModel: raw?.active_model ?? null,
    activePool: raw?.active_pool ?? null,
    pools
  };
}

export function readAllQuota(options = {}) {
  return {
    claude: readProviderQuota("claude", options),
    agy: readProviderQuota("agy", options)
  };
}

function poolBottleneckRem(poolObj) {
  const vals = [poolObj["5h"]?.effectiveRemainingPct, poolObj["7d"]?.effectiveRemainingPct].filter(
    (v) => typeof v === "number"
  );
  return vals.length ? Math.min(...vals) : null;
}

export function decideRoute(options = {}) {
  const all = readAllQuota(options);
  const min5h = options.min5h ?? 10;
  const min7d = options.min7d ?? 5;
  const preferred = options.preferred ?? null;
  const requestedAgyPool = options.model ? resolveAgyPool(options.model) : "gemini";

  const candidates = [
    { provider: "claude", pool: "default", data: all.claude.pools.default },
    { provider: "agy", pool: requestedAgyPool, data: all.agy.pools[requestedAgyPool] },
    ...(requestedAgyPool !== "gemini"
      ? [{ provider: "agy", pool: "gemini", data: all.agy.pools.gemini }]
      : [])
  ];

  const evaluated = candidates.map((c) => {
    const r5 = c.data["5h"]?.effectiveRemainingPct;
    const r7 = c.data["7d"]?.effectiveRemainingPct;
    const s5 = c.data["5h"]?.state ?? "unknown";
    const s7 = c.data["7d"]?.state ?? "unknown";
    const exhausted = s5 === "exhausted" || s7 === "exhausted";
    const belowFloor =
      (typeof r5 === "number" && r5 < min5h) || (typeof r7 === "number" && r7 < min7d);
    const eligible = !exhausted && !belowFloor;
    const score = poolBottleneckRem(c.data) ?? 50; // unknown -> neutral optimistic score
    const preferredBonus = preferred && c.provider === preferred ? 5 : 0;
    return {
      provider: c.provider,
      pool: c.pool,
      eligible,
      exhausted,
      belowFloor,
      score: score + preferredBonus,
      rem5h: r5,
      rem7d: r7,
      state5h: s5,
      state7d: s7,
      resetsAt5h: c.data["5h"]?.resetsAt ?? null
    };
  });

  const eligibleList = evaluated
    .filter((e) => e.eligible)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ra = a.resetsAt5h ?? Number.MAX_SAFE_INTEGER;
      const rb = b.resetsAt5h ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });

  const selected = eligibleList[0] ?? null;
  const reason = selected
    ? `Selected ${selected.provider}:${selected.pool} (5h rem=${selected.rem5h ?? "unknown"}%, 7d rem=${selected.rem7d ?? "unknown"}%)`
    : "All candidate pools are exhausted or below reserve floor.";

  return {
    selected: selected ? { provider: selected.provider, pool: selected.pool } : null,
    reason,
    candidates: evaluated
  };
}
