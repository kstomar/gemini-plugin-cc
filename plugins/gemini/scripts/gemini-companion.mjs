#!/usr/bin/env node
/**
 * Gemini companion for Claude Code.
 *
 * Thin wrapper around the local `gemini` CLI (@google/gemini-cli).
 * Subcommands:
 *   setup [--json]                Check gemini install + auth.
 *   review "<args>"               Read-only code review of local git state.
 *   adversarial-review "<args>"   Challenge review questioning design choices.
 *   task "<args>"                 Delegate a task to Gemini (optionally write-capable).
 *   transfer                      Not supported; Gemini CLI has no session import.
 *   status [taskId]               Show tracked jobs for this repo.
 *   result [taskId]               Show final stored output for a job.
 *   cancel [taskId]               Cancel a running background job.
 *   task-resume-candidate         Report whether a resumable thread exists (--json).
 *
 * Design: Gemini CLI is invoked non-interactively with `gemini -p "<prompt>"`.
 * Write access is granted with `--yolo` (auto-approve tool calls). Read-only
 * runs omit it. Job state is persisted per-repo under .gemini-cc/state.json.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";

// ---------- helpers ----------

function repoRoot() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}

function stateDir() {
  const dir = join(repoRoot(), ".gemini-cc");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function statePath() {
  return join(stateDir(), "state.json");
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return { jobs: [] };
  }
}

function saveState(state) {
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function upsertJob(job) {
  const state = loadState();
  const i = state.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) state.jobs[i] = { ...state.jobs[i], ...job };
  else state.jobs.unshift(job);
  state.jobs = state.jobs.slice(0, 50);
  saveState(state);
}

function findJob(taskId) {
  const state = loadState();
  if (taskId) return state.jobs.find((j) => j.id === taskId) || null;
  return state.jobs[0] || null;
}

function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
}

function currentSessionId() {
  return process.env[SESSION_ID_ENV] || null;
}

/** Split a raw "$ARGUMENTS" string into flags and free text. */
function parseArgs(raw) {
  const tokens = (raw || "").trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const flags = {};
  const rest = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/^"|"$/g, "");
    if (t === "--background") flags.background = true;
    else if (t === "--wait") flags.wait = true;
    else if (t === "--write") flags.write = true;
    else if (t === "--resume" || t === "--resume-last") flags.resume = true;
    else if (t === "--fresh") flags.fresh = true;
    else if (t === "--base") flags.base = tokens[++i]?.replace(/^"|"$/g, "");
    else if (t === "--model") flags.model = tokens[++i]?.replace(/^"|"$/g, "");
    else if (t === "--scope") flags.scope = tokens[++i]?.replace(/^"|"$/g, "");
    else rest.push(t);
  }
  return { flags, text: rest.join(" ").trim() };
}

// ---------- gemini invocation ----------

function geminiBaseArgs(flags) {
  const args = ["--skip-trust"];
  if (flags.model) args.push("-m", flags.model);
  return args;
}

/** Run gemini -p "<prompt>" synchronously, return {code, stdout, stderr}. */
function runGemini(prompt, flags, { write } = {}) {
  const args = geminiBaseArgs(flags);
  if (write) args.push("--yolo"); // auto-approve edits/tools
  args.push("-p", prompt);
  const r = spawnSync("gemini", args, {
    encoding: "utf8",
    cwd: repoRoot(),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// ---------- git diff collection ----------

function collectReviewTarget(flags) {
  const cwd = repoRoot();
  if (flags.base) {
    const diff = spawnSync("git", ["diff", `${flags.base}...HEAD`], {
      encoding: "utf8",
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { label: `branch vs ${flags.base}`, diff: diff.stdout || "" };
  }
  const staged = spawnSync("git", ["diff", "--cached"], { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 });
  const unstaged = spawnSync("git", ["diff"], { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 });
  const status = spawnSync("git", ["status", "--short", "--untracked-files=all"], { encoding: "utf8", cwd });
  return {
    label: "working tree",
    diff: `${staged.stdout || ""}\n${unstaged.stdout || ""}`.trim(),
    status: status.stdout || "",
  };
}

// ---------- subcommands ----------

function cmdSetup(raw) {
  const json = raw.includes("--json");
  const bin = which("gemini");
  const npm = which("npm");
  let authed = false;
  let version = null;
  if (bin) {
    const v = spawnSync("gemini", ["--version"], { encoding: "utf8" });
    version = (v.stdout || "").trim() || null;
    // A cheap auth probe: a trivial prompt. Non-zero / auth error => not ready.
    const probe = spawnSync("gemini", ["--skip-trust", "-p", "reply with: ok"], {
      encoding: "utf8",
      timeout: 30000,
    });
    const out = `${probe.stdout || ""}${probe.stderr || ""}`.toLowerCase();
    authed =
      probe.status === 0 &&
      !out.includes("auth") &&
      !out.includes("api key") &&
      !out.includes("login") &&
      !out.includes("gemini_api_key");
  }
  const result = {
    installed: Boolean(bin),
    authenticated: authed,
    version,
    npmAvailable: Boolean(npm),
    binPath: bin,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (!result.installed) {
    console.log("Gemini CLI is NOT installed.");
    if (result.npmAvailable) console.log("Install with: npm install -g @google/gemini-cli");
    return 1;
  }
  console.log(`Gemini CLI installed${version ? ` (${version})` : ""}.`);
  if (!authed) {
    console.log(
      "Gemini is installed but not authenticated. Run `!gemini` once to sign in,\n" +
        "or set GEMINI_API_KEY in your environment (get a key at https://aistudio.google.com/apikey)."
    );
    return 1;
  }
  console.log("Gemini is ready.");
  return 0;
}

function cmdReview(raw) {
  const { flags } = parseArgs(raw);
  const target = collectReviewTarget(flags);
  if (!target.diff && !(target.status || "").trim()) {
    console.log("No changes to review.");
    return 0;
  }
  const prompt = [
    "You are a senior code reviewer. Perform a READ-ONLY review.",
    "Do NOT propose to edit files. Do NOT run write tools. Output findings only.",
    "",
    `Review target: ${target.label}`,
    target.status ? `\nGit status:\n${target.status}` : "",
    "",
    "Group findings by severity (Critical / High / Medium / Low / Nit).",
    "For each: file:line, what's wrong, why it matters, suggested fix.",
    "End with a one-line verdict: SHIP or DO-NOT-SHIP.",
    "",
    "Diff under review:",
    "```diff",
    target.diff.slice(0, 400000),
    "```",
  ].join("\n");

  const started = new Date().toISOString();
  if (flags.background) {
    return launchBackground("review", prompt, flags, { write: false });
  }
  const res = runGemini(prompt, flags, { write: false });
  const output = res.stdout.trim() || res.stderr.trim();
  upsertJob({
    id: `task-${randomUUID().slice(0, 8)}`,
    kind: "review",
    status: res.code === 0 ? "completed" : "failed",
    sessionId: currentSessionId(),
    started,
    finished: new Date().toISOString(),
    output,
  });
  console.log(output);
  return res.code;
}

function cmdAdversarialReview(raw) {
  const { flags, text: focusText } = parseArgs(raw);
  const target = collectReviewTarget(flags);
  if (!target.diff && !(target.status || "").trim()) {
    console.log("No changes to review.");
    return 0;
  }
  const prompt = [
    "You are performing an ADVERSARIAL code review. Your job is to challenge the implementation.",
    "Default to skepticism. Find the strongest reasons this change should NOT ship yet.",
    "Do NOT propose to edit files. Do NOT run write tools. Output findings only.",
    "",
    focusText ? `User focus: ${focusText}` : "",
    `Review target: ${target.label}`,
    target.status ? `\nGit status:\n${target.status}` : "",
    "",
    "Attack surface priorities: auth/permissions/tenant isolation, data loss/corruption/irreversible state,",
    "rollback safety/retries/idempotency, race conditions/ordering assumptions, empty-state/null/timeout behavior,",
    "version skew/schema drift/migration hazards, observability gaps that hide failures.",
    "",
    "For each finding: file:line, what can go wrong, why it's vulnerable, likely impact, concrete fix.",
    "Group by severity (Critical / High / Medium / Low).",
    "End with SHIP or DO-NOT-SHIP verdict and one-line justification.",
    "",
    "Diff under review:",
    "```diff",
    target.diff.slice(0, 400000),
    "```",
  ].filter(Boolean).join("\n");

  const started = new Date().toISOString();
  if (flags.background) {
    return launchBackground("adversarial-review", prompt, flags, { write: false });
  }
  const res = runGemini(prompt, flags, { write: false });
  const output = res.stdout.trim() || res.stderr.trim();
  upsertJob({
    id: `task-${randomUUID().slice(0, 8)}`,
    kind: "adversarial-review",
    status: res.code === 0 ? "completed" : "failed",
    sessionId: currentSessionId(),
    started,
    finished: new Date().toISOString(),
    output,
  });
  console.log(output);
  return res.code;
}

function cmdTask(raw) {
  const { flags, text } = parseArgs(raw);
  if (!text) {
    console.error("No task text provided.");
    return 1;
  }
  const write = flags.write === true;
  let prompt = text;
  if (flags.resume) {
    prompt = `Continue the previous task in this repository. Follow-up instruction:\n${text}`;
  }
  if (!write) {
    prompt = `${prompt}\n\n(Investigate and report only. Do not edit files.)`;
  }
  const started = new Date().toISOString();
  if (flags.background) {
    return launchBackground("task", prompt, flags, { write });
  }
  const res = runGemini(prompt, flags, { write });
  const output = res.stdout.trim() || res.stderr.trim();
  upsertJob({
    id: `task-${randomUUID().slice(0, 8)}`,
    kind: "task",
    status: res.code === 0 ? "completed" : "failed",
    sessionId: currentSessionId(),
    started,
    finished: new Date().toISOString(),
    output,
  });
  console.log(output);
  return res.code;
}

function cmdTransfer(raw) {
  console.log(
    "Session transfer is not supported by the Gemini CLI.\n" +
      "To continue work in Gemini, start a new session with:\n" +
      "  !gemini\n" +
      "and provide the relevant context from this conversation."
  );
  return 0;
}

/**
 * Detached background run. Writes output to the job's file as it completes.
 * The parent process here also detaches, so Claude Code's own
 * run_in_background is what keeps it non-blocking; we just track state.
 */
function launchBackground(kind, prompt, flags, { write }) {
  const id = `task-${randomUUID().slice(0, 8)}`;
  const outFile = join(stateDir(), `${id}.out`);
  upsertJob({
    id,
    kind,
    status: "running",
    sessionId: currentSessionId(),
    started: new Date().toISOString(),
    finished: null,
    outFile,
    pid: null,
  });

  const args = geminiBaseArgs(flags);
  if (write) args.push("--yolo");
  args.push("-p", prompt);

  const child = spawn("gemini", args, {
    cwd: repoRoot(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buf = "";
  child.stdout.on("data", (d) => (buf += d));
  child.stderr.on("data", (d) => (buf += d));
  child.on("close", (code) => {
    writeFileSync(outFile, buf);
    upsertJob({
      id,
      status: code === 0 ? "completed" : "failed",
      finished: new Date().toISOString(),
      output: buf.trim(),
    });
  });
  upsertJob({ id, pid: child.pid });
  child.unref();

  console.log(`Started background ${kind} job ${id}. Check with: /gemini:status ${id}`);
  return 0;
}

function cmdStatus(raw) {
  const { text } = parseArgs(raw);
  const state = loadState();
  if (!state.jobs.length) {
    console.log("No Gemini jobs recorded for this repo.");
    return 0;
  }
  if (text) {
    const job = findJob(text);
    if (!job) {
      console.log(`No job found with id ${text}.`);
      return 1;
    }
    console.log(formatJob(job));
    return 0;
  }
  console.log("Recent Gemini jobs:\n");
  for (const j of state.jobs.slice(0, 10)) console.log(formatJob(j));
  return 0;
}

function formatJob(j) {
  return `[${j.id}] ${j.kind} — ${j.status} (started ${j.started}${
    j.finished ? `, finished ${j.finished}` : ""
  })`;
}

function cmdResult(raw) {
  const { text } = parseArgs(raw);
  const job = findJob(text);
  if (!job) {
    console.log(text ? `No job found with id ${text}.` : "No jobs recorded.");
    return 1;
  }
  let output = job.output;
  if (!output && job.outFile && existsSync(job.outFile)) {
    output = readFileSync(job.outFile, "utf8");
  }
  if (job.status === "running") {
    console.log(`Job ${job.id} is still running. Try /gemini:status.`);
    return 0;
  }
  console.log(output || "(no output captured)");
  return 0;
}

function cmdCancel(raw) {
  const { text } = parseArgs(raw);
  const job = findJob(text);
  if (!job) {
    console.log(text ? `No job found with id ${text}.` : "No jobs to cancel.");
    return 1;
  }
  if (job.status !== "running") {
    console.log(`Job ${job.id} is not running (status: ${job.status}).`);
    return 0;
  }
  if (job.pid) {
    try {
      process.kill(-job.pid, "SIGTERM");
    } catch {
      try {
        process.kill(job.pid, "SIGTERM");
      } catch {}
    }
  }
  upsertJob({ id: job.id, status: "cancelled", finished: new Date().toISOString() });
  console.log(`Cancelled job ${job.id}.`);
  return 0;
}

function cmdResumeCandidate(raw) {
  const json = raw.includes("--json");
  const last = loadState().jobs.find((j) => j.kind === "task");
  const available = Boolean(last);
  if (json) {
    console.log(JSON.stringify({ available, jobId: last?.id || null }));
  } else {
    console.log(available ? `Resumable thread: ${last.id}` : "No resumable thread.");
  }
  return 0;
}

// ---------- dispatch ----------

const [, , sub, ...rest] = process.argv;
const raw = rest.join(" ");
let code = 0;
switch (sub) {
  case "setup":
    code = cmdSetup(raw);
    break;
  case "review":
    code = cmdReview(raw);
    break;
  case "adversarial-review":
    code = cmdAdversarialReview(raw);
    break;
  case "task":
    code = cmdTask(raw);
    break;
  case "transfer":
    code = cmdTransfer(raw);
    break;
  case "status":
    code = cmdStatus(raw);
    break;
  case "result":
    code = cmdResult(raw);
    break;
  case "cancel":
    code = cmdCancel(raw);
    break;
  case "task-resume-candidate":
    code = cmdResumeCandidate(raw);
    break;
  default:
    console.error(
      "Usage: gemini-companion.mjs <setup|review|adversarial-review|task|transfer|status|result|cancel|task-resume-candidate> [args]"
    );
    code = 1;
}
process.exit(code);
