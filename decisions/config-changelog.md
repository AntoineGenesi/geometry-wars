# Config & Rules Changelog

Every change to `.claude/rules/`, `.claude/agents/`, `.claude/commands/`, or `.claude/scripts/` must be logged here with the WHY.

Format: `[date] [file] — [what changed] — [why / trigger]`

---

## 2026-03-13 — s44r14 Infrastructure Overhaul

### Merge Gate Fixes
- `merge-gate-hook.sh` — Fixed verdict parsing (VERDICT line only), fixed TODO.md follow-up check (require explicit follow-up), added MERGE_BLOCKED support — **Why:** FC-36 — autonomous mode bypassed merge gate 4 times in s44r13 via 3 mechanisms: certificate never read, certificate partially read, haiku reviewer missed regression
- `.git/hooks/pre-merge-commit` — NEW hook catching ALL merges at git level — **Why:** PreToolUse hook only fires at Claude tool-call level, not for orchestrator subprocesses. Defense-in-depth.
- `orchestrator.sh` merge gates (cmd_merge_auto, cmd_merge, run_verification_gate) — Same 3 fixes as merge-gate-hook.sh — **Why:** Same bugs existed in all 3 merge code paths

### Reviewer Upgrade
- `reviewer.md` — Changed model haiku→sonnet, added MERGE_BLOCKED + Blockers to output format — **Why:** Haiku missed critical regression in s44r13-08 (invisible enemies). Process auditing requires sonnet-level intelligence.
- `orchestrator.sh` reviewer spawn — haiku→sonnet — **Why:** Same as above

### Two-Phase Model
- `orchestrator.sh` — Added get_task_complexity(), run_research_phase(), modified start_worker() and build_worker_prompt() — **Why:** User discovered planner was never wired in despite existing for 1.5 months. Research agent ensures workers don't start from zero. Time-capped (15/25/30 min by complexity).

### Worker Session Registry
- `orchestrator.sh` — Added register_worker_session() and complete_worker_session() — **Why:** No way to trace back from a task slug to its JSONL transcript, session UUID, or worker conversation. User couldn't review what workers actually did.
- `index-worker-sessions.sh` — NEW retroactive indexer for 268 existing sessions — **Why:** Registry only captures new sessions going forward. Backfill needed for all historical workers.

### Audit Improvements
- `commands/audit.md` — Rewritten: haiku→sonnet, added 4 new audit categories (research phase, merge gates, worker registry, config documentation), added auto-trigger guidance — **Why:** Audit was too shallow — didn't catch that research phase wasn't running, didn't verify merge gates actually worked, didn't check config changes had documented reasons.

### Post-Wave Audit
- `scripts/post-wave-audit.sh` — NEW automated post-wave check — **Why:** Manual audit relies on someone remembering to run it. Automated trigger catches violations immediately.

### Verification Protocol
- `verification-protocol.md` — Added Certificate Reading Rules section (5 rules), added Automated Merge Gates section — **Why:** s44r13 coordinator read only 20-30 lines of 100-230 line certificates, missing "DO NOT MERGE" recommendations at the bottom.

### Failure Documentation
- `failure-catalog.md` — Added FC-36 (autonomous merge gate bypass, 3 mechanisms) — **Why:** New failure mode distinct from FC-03 — FC-03 is about knowing the rule, FC-36 is about the automated enforcement being broken.
- `failure-modes-quick-ref.md` — Added #28 (FC-36 summary) — **Why:** Quick reference needs to stay in sync with catalog.

### Pipeline Enforcement (s44r15)
- `~/.claude/scripts/enforce-orchestrator.sh` — NEW PreToolUse hook on Agent tool. Blocks `implementer` and `phase-coordinator` subagent types (must use orchestrator). Warns on general-purpose agents with implementation-like prompts. — **Why:** Main context repeatedly bypassed orchestrator pipeline by manually spawning Task subagent implementers, skipping research phase, checkpoint monitor, and review gate. User explicitly asked "will you actually follow the full pipeline properly?" and "do you have auto triggers?"
- `~/.claude/settings.json` — Added `tool == "Agent"` matcher to PreToolUse hooks — **Why:** Hook won't fire unless registered
- `commands/audit.md` — Added section 3c: Pipeline Enforcement audit checks — **Why:** Need to verify research→implement→review pipeline was followed, not just that certificates exist

### Checkpoint Monitor Fixes (s44r15)
- `scripts/checkpoint-monitor.sh` — 4 bug fixes: (1) scratch file looked at project root not worktree, (2) non-existent scratch reported as fresh instead of stale, (3) `cd` without subshell in get_src_diff_lines, (4) patch_attempt_detected never reset after worker reverted — **Why:** Monitor logs showed scratch_stale=29555414min and zero interventions sent despite workers stalling for 30+ minutes. Retroactive audit identified this as "#1 unfixed issue" blocking 3 rules simultaneously.

### LSP Wrapper Durability (s44r15)
- `~/.local/bin/claude` — Changed from hardcoded version path to dynamic binary lookup (latest in versions dir) — **Why:** `claude update` overwrites the wrapper. Hardcoding `2.1.74` would break after update.
- `scripts/session-start-todos.sh` — Added LSP wrapper detection (warns if wrapper overwritten by symlink) — **Why:** Auto-detection so the user knows LSP is broken after an update

---

## Template for Future Entries

```
## [date] — [session/context]

### [Category]
- `[file]` — [what changed] — **Why:** [user request / failure mode / audit finding / performance data]
```
