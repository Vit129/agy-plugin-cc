import process from "node:process";
import readline from "node:readline";

import { runClaudePrompt, selectClaudeModel } from "./lib/claude.mjs";
import { checkClaudeRoute } from "./lib/delegation-route.mjs";
import { appendUsageLog, nowIso } from "./lib/state.mjs";

const TOOLS = [
  {
    name: "ask_claude",
    description:
      "Ask Claude Code CLI (headless, read-only by default) for a cold code review, second opinion, or bounded analysis. Supports multi-turn resume via session_id. Uses local Claude subscription (no API keys).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt or diff/context to send to Claude." },
        cwd: { type: "string", description: "Working directory (optional)." },
        model: { type: "string", description: "Model alias or full ID (e.g. sonnet, opus, haiku)." },
        effort: { type: "string", enum: ["low", "medium", "high"], description: "Reasoning effort." },
        resume: { type: "string", description: "Session ID from a previous persisted ask_claude call to continue." },
        persist: { type: "boolean", description: "Keep session on disk and return session_id for follow-up turns." },
        no_tools: { type: "boolean", description: "Disable all tools (lowest token overhead when diff is in prompt)." },
        edit: { type: "boolean", description: "Allow file edits (default false / read-only)." },
        route: { type: "string", enum: ["auto", "off"], default: "auto", description: "Apply cached quota routing or explicitly bypass it." }
      },
      required: ["prompt"]
    }
  }
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleRequest(req) {
  const { id, method, params } = req;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cc-plugin-agy", version: "2.0.0" }
      }
    });
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name !== "ask_claude") {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` }
      });
      return;
    }
    try {
      const cwd = args.cwd || process.cwd();
      if (!String(args.prompt ?? "").trim()) throw new Error("Prompt must not be empty.");
      const diversion = checkClaudeRoute(cwd, "mcp:ask_claude", args.route);
      if (diversion) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: diversion.message }], isError: true } });
        return;
      }
      const picked = selectClaudeModel({
        kind: "ask",
        promptLength: String(args.prompt || "").length,
        edit: Boolean(args.edit),
        model: args.model,
        effort: args.effort
      });
      const res = await runClaudePrompt(args.prompt, {
        cwd,
        model: picked.model,
        effort: picked.effort,
        resume: args.resume,
        persist: Boolean(args.persist || args.resume),
        noTools: Boolean(args.no_tools),
        edit: Boolean(args.edit)
      });

      if (res.usage) {
        try {
          appendUsageLog(cwd, {
            at: nowIso(),
            kind: "mcp:ask_claude",
            status: res.exitCode === 0 ? "completed" : "failed",
            quotaError: res.quotaError,
            sessionId: res.sessionId,
            ...res.usage
          });
        } catch {
          // Non-fatal
        }
      }

      const metaParts = [];
      metaParts.push(
        `[model: ${picked.model}${picked.effort ? `, effort: ${picked.effort}` : ""}${picked.auto ? " (auto)" : ""}]`
      );
      if ((args.persist || args.resume) && res.sessionId) {
        metaParts.push(`[session_id: ${res.sessionId}]`);
      }
      const sessionFooter = `\n\n${metaParts.join(" ")}`;
      const text =
        res.exitCode === 0
          ? `${res.text}${sessionFooter}`
          : `Claude returned exit ${res.exitCode}${res.quotaError ? " (QUOTA/RATE-LIMIT)" : ""}:\n${res.stderr || res.text}`;
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }],
          isError: res.exitCode !== 0
        }
      });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true
        }
      });
    }
    return;
  }
  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    void handleRequest(req);
  } catch {
    // Ignore malformed lines
  }
});
