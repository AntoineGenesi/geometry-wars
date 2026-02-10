## 2026-02-11 - Agent Registry Data Quality Fix

**Context:** Agents.json had 87.5% of entries with useless descriptions ("unknown", "pending", or null) and 62.5% missing agent_type. Root cause: SubagentStart doesn't always fire, and PostToolUse enrichment only works for explicit Task tool calls.

**Options Considered:**
1. Only track agents spawned via Task tool (simplest, but loses visibility into Explore/Bash agents)
2. Use transcript extraction on SubagentStop to get descriptions (moderate complexity, best data quality)
3. Require all agent spawns to go through Task tool (high friction, doesn't match natural usage)

**Decision:** Option 2 — Transcript-based description extraction on SubagentStop

**Reasoning:**
- The `agent_transcript_path` field is available on SubagentStop events
- Extracting the first user message gives a meaningful description without requiring changes to how agents are spawned
- Graceful degradation: if transcript is missing or unreadable, falls back to "pending"
- No impact on agent performance (extraction only happens on stop)

**Reversibility:** Easy — Revert track-subagent.sh to previous version. Description extraction is additive only.
