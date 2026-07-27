# Gemini plugin for Claude Code

Use Gemini from inside Claude Code for code reviews or to delegate tasks to Gemini.

This plugin is for Claude Code users who want an easy way to start using Gemini from the workflow
they already have.

## What You Get

- `/gemini:review` for a normal read-only Gemini review
- `/gemini:adversarial-review` for a steerable challenge review
- `/gemini:rescue`, `/gemini:transfer`, `/gemini:status`, `/gemini:result`, and `/gemini:cancel` to delegate work, manage background jobs, and check results

## Requirements

- **Google AI Studio API key or Google account.**
  - Get a free API key at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add kstomar/gemini-plugin-cc
```

Install the plugin:

```bash
/plugin install gemini@google-gemini
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/gemini:setup
```

`/gemini:setup` will tell you whether Gemini is ready. If Gemini CLI is missing and npm is available, it can offer to install it for you.

If you prefer to install Gemini CLI yourself, use:

```bash
npm install -g @google/gemini-cli
```

If Gemini CLI is installed but not authenticated yet, either set your API key:

```bash
export GEMINI_API_KEY=your_key_here
```

Or run the interactive login:

```bash
!gemini
```

After install, you should see:

- the slash commands listed below
- the `gemini:gemini-rescue` subagent in `/agents`

One simple first run is:

```bash
/gemini:review --background
/gemini:status
/gemini:result
```

## Usage

### `/gemini:review`

Runs a normal Gemini review on your current work. It gives you the same quality of code review as running a review prompt directly inside Gemini.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/gemini:adversarial-review`](#geminiAdversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/gemini:review
/gemini:review --base main
/gemini:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/gemini:status`](#geministatus) to check on the progress and [`/gemini:cancel`](#geminicancel) to cancel the ongoing task.

### `/gemini:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/gemini:review`, including `--base <ref>` for branch review.
It also supports `--wait` and `--background`. Unlike `/gemini:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/gemini:adversarial-review
/gemini:adversarial-review --base main challenge whether this was the right caching and retry design
/gemini:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/gemini:rescue`

Hands a task to Gemini through the `gemini:gemini-rescue` subagent.

Use it when you want Gemini to:

- investigate a bug
- try a fix
- continue a previous Gemini task
- take a pass with a different perspective

> [!NOTE]
> Depending on the task these runs might take a long time and it's generally recommended to run them in the background.

It supports `--background`, `--wait`, `--resume`, and `--fresh`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest rescue thread for this repo.

Examples:

```bash
/gemini:rescue investigate why the tests started failing
/gemini:rescue fix the failing test with the smallest safe patch
/gemini:rescue --resume apply the top fix from the last run
/gemini:rescue --model gemini-2.5-pro investigate the flaky integration test
/gemini:rescue --background investigate the regression
```

You can also just ask for a task to be delegated to Gemini:

```text
Ask Gemini to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model`, Gemini chooses its own defaults.
- follow-up rescue requests can continue the latest Gemini task in the repo

### `/gemini:transfer`

Prints guidance for transferring the current Claude Code session context into a new Gemini session.

> [!NOTE]
> Gemini CLI does not support automated session import from Claude Code. This command explains how to continue manually in Gemini.

Examples:

```bash
/gemini:transfer
```

### `/gemini:status`

Shows running and recent Gemini jobs for the current repository.

Examples:

```bash
/gemini:status
/gemini:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/gemini:result`

Shows the final stored Gemini output for a finished job.

Examples:

```bash
/gemini:result
/gemini:result task-abc123
```

### `/gemini:cancel`

Cancels an active background Gemini job.

Examples:

```bash
/gemini:cancel
/gemini:cancel task-abc123
```

### `/gemini:setup`

Checks whether Gemini CLI is installed and authenticated.
If Gemini CLI is missing and npm is available, it can offer to install it for you.

## Typical Flows

### Review Before Shipping

```bash
/gemini:review
```

### Hand A Problem To Gemini

```bash
/gemini:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/gemini:adversarial-review --background
/gemini:rescue --background investigate the flaky test
```

Then check in with:

```bash
/gemini:status
/gemini:result
```

## Gemini Integration

The Gemini plugin wraps the [`@google/gemini-cli`](https://github.com/google-gemini/gemini-cli) package. It uses the global `gemini` binary installed in your environment.

### Authentication

Gemini CLI supports two authentication modes:

- **Google account**: Run `!gemini` once to sign in interactively.
- **API key**: Set `GEMINI_API_KEY` in your environment. Get a free key at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### Common Configurations

Job state for this plugin is stored per-repo under `.gemini-cc/state.json`. You may want to add `.gemini-cc/` to your `.gitignore`.

## FAQ

### Do I need a separate Gemini account for this plugin?

If you are already signed into Gemini CLI on this machine, that authentication should work immediately here too. This plugin uses your local Gemini CLI authentication.

If you only use Claude Code today and have not used Gemini CLI yet, you will need to sign in. The easiest way is to set `GEMINI_API_KEY` (get a free key at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)), or run `!gemini` for interactive sign-in. Run `/gemini:setup` to check whether Gemini is ready.

### Does the plugin use a separate Gemini runtime?

No. This plugin delegates through your local `gemini` CLI on the same machine.

That means:

- it uses the same Gemini install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Can I keep using my existing API key setup?

Yes. Because the plugin uses your local Gemini CLI, your existing `GEMINI_API_KEY` or sign-in state still applies.
