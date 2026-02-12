## 2026-02-12 — Main Context Pollution: Doing Worker Work in Coordinator Context

**Context:** After triager processed a voice dump into 9 tasks (2 COMPLEX, 1 EPIC, 6 STANDARD/QUICK), the main agent decided to "investigate the critical blocker first" and spent its entire context window doing detailed code investigation: reading GameLoop.ts, MeshWalker.ts, Player.ts, CollisionSystem.ts, GameClock.ts, tracing code paths, finding bugs, and applying fixes.

**What should have happened:**
1. Triager produces tasks with complexity classifications
2. Main agent spawns planners for COMPLEX/EPIC tasks
3. Planners decompose into sub-tasks
4. Main agent spawns workers for all STANDARD/QUICK tasks + sub-tasks from planners
5. Main agent waits, coordinates, handles merges — ZERO code-level work

**What actually happened:**
1. Triager produced 9 tasks correctly
2. Main agent said "game regression blocks everything, let me investigate first"
3. Main agent spawned 3 investigation sub-agents (good) BUT ALSO read files directly
4. Main agent read: Game.ts, GameLoop.ts, Player.ts, CollisionSystem.ts, MeshWalker.ts, GameClock.ts, DISCOVERIES.md, EnemySpawner.ts, BaseEnemy.ts
5. Main agent searched for patterns, traced code paths, identified root causes
6. Main agent applied fixes directly (GlowTrail import, try/catch safety)
7. Main agent verified compilation and tests
8. By this point, context was polluted with thousands of lines of implementation detail
9. User had to intervene: "YOUR CONTEXT MUST BE PURELY HIGH LEVEL, ALL DETAILS ARE FOR SUBAGENTS"

**Root cause of the mistake:**
- The agent rationalized "this task blocks everything, so I should handle it to unblock faster"
- This is wrong — even blocking tasks should be delegated to workers
- The speed gain of "doing it yourself" is illusory because it destroys context capacity for coordination

**Decision:** NEVER do detailed code work in main context. This is now encoded in:
- MEMORY.md (auto-loaded every session)
- CLAUDE.md failure mode #10
- This decision file

**Reversibility:** Easy — this is a behavioral rule, not code change
