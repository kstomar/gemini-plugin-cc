#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || !value) return;
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

function repoRootFor(cwd) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd });
  return r.status === 0 ? r.stdout.trim() : cwd;
}

function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
}

function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  const root = repoRootFor(cwd);
  const statePath = join(root, ".gemini-cc", "state.json");
  if (!fs.existsSync(statePath)) return;

  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const sessionId = input.session_id || process.env[SESSION_ID_ENV];
    if (!sessionId) return;

    for (const job of state.jobs) {
      if (job.sessionId !== sessionId || job.status !== "running") continue;
      try { process.kill(-job.pid, "SIGTERM"); } catch {
        try { process.kill(job.pid, "SIGTERM"); } catch {}
      }
    }

    state.jobs = state.jobs.map((j) =>
      j.sessionId === sessionId && j.status === "running"
        ? { ...j, status: "cancelled", finished: new Date().toISOString() }
        : j
    );
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {}
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";
  if (eventName === "SessionStart") handleSessionStart(input);
  if (eventName === "SessionEnd") handleSessionEnd(input);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
