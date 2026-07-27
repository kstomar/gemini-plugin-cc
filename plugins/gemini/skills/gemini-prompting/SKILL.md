---
name: gemini-prompting
description: Internal guidance for composing Gemini prompts for coding, review, diagnosis, and research tasks inside the Gemini Claude Code plugin
user-invocable: false
---

# Gemini Prompting

Use this skill when `gemini:gemini-rescue` needs to ask Gemini for help.

Prompt Gemini like an operator, not a collaborator. Keep prompts compact and block-structured with XML tags. State the task, the output contract, the follow-through defaults, and the small set of extra constraints that matter.

Core rules:
- Prefer one clear task per Gemini run. Split unrelated asks into separate runs.
- Tell Gemini what done looks like. Do not assume it will infer the desired end state.
- Add explicit grounding and verification rules for any task where unsupported guesses would hurt quality.
- Prefer better prompt contracts over long natural-language explanations.
- Use XML tags consistently so the prompt has stable internal structure.

Default prompt recipe:
- `<task>`: the concrete job and the relevant repository or failure context.
- `<output_contract>`: exact shape, ordering, and brevity requirements.
- `<default_follow_through_policy>`: what Gemini should do by default instead of asking routine questions.
- `<verification_loop>`: required for debugging, implementation, or risky fixes.
- `<grounding_rules>`: required for review, research, or anything that could drift into unsupported claims.

When to add blocks:
- Coding or debugging: add `verification_loop` and `missing_context_gating`.
- Review or adversarial review: add `grounding_rules`, `output_contract`, and a dig-deeper nudge.
- Research or recommendation tasks: add research mode and citation rules.
- Write-capable tasks: add `action_safety` so Gemini stays narrow and avoids unrelated refactors.

How to choose prompt shape:
- Use built-in `review` or `adversarial-review` commands when the job is reviewing local git changes. Those prompts already carry the review contract.
- Use `task` when the task is diagnosis, planning, research, or implementation and you need to control the prompt more directly.
- Use `task --resume` for follow-up instructions on the same Gemini thread. Send only the delta instruction instead of restating the whole prompt unless the direction changed materially.

Working rules:
- Prefer explicit prompt contracts over vague nudges.
- Use stable XML tag names.
- Do not raise complexity first. Tighten the prompt and verification rules before escalating.
- Keep claims anchored to observed evidence. If something is a hypothesis, say so.

Prompt assembly checklist:
1. Define the exact task and scope in `<task>`.
2. Choose the smallest output contract that still makes the answer easy to use.
3. Decide whether Gemini should keep going by default or stop for missing high-risk details.
4. Add verification, grounding, and safety tags only where the task needs them.
5. Remove redundant instructions before sending the prompt.
