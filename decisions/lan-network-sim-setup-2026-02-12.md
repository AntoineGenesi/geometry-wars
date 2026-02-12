# Network Simulation Script Implementation — 2026-02-12

## Context

LAN multiplayer testing requires simulating real-world network conditions (latency, packet loss, jitter) on localhost. Phase 1 research selected `tc qdisc netem` as the tool. This decision documents the Phase 2 implementation approach.

## Requirements

1. Simple shell script wrapper around tc netem
2. Parameter validation to prevent invalid values
3. Safety checks to prevent double-apply and other footguns
4. Support both positional and named arguments for flexibility
5. Idempotent operations (especially reset)
6. Built-in latency testing capability
7. Comprehensive documentation with troubleshooting

## Options Considered

### Option A: Direct tc Commands (No Wrapper)
**Pros:**
- No additional code to maintain
- Users learn tc commands directly
- No abstraction layer

**Cons:**
- Easy to forget cleanup (rules persist)
- Easy to double-apply rules (causes errors)
- No parameter validation (can apply nonsensical values)
- Requires memorizing tc syntax
- No built-in testing capability

### Option B: Node.js Script
**Pros:**
- Can integrate with test suite easily
- Better error handling and async/await
- Cross-platform potential

**Cons:**
- Requires Node.js runtime (adds dependency)
- More complex than needed for simple wrapper
- Still needs to shell out to tc anyway
- Slower startup than bash

### Option C: Shell Script Wrapper (CHOSEN)
**Pros:**
- No additional dependencies (bash + tc)
- Fast startup
- Easy to use: `./scripts/network-sim.sh apply --latency 100ms`
- Can add validation, safety checks, help text
- Portable across any Linux system
- Can be called from test suites

**Cons:**
- Bash error handling can be tricky
- Need to handle both positional and named args

## Decision: Shell Script Wrapper

**Reasoning:**
- Simplicity: ~300 lines of bash vs potentially 500+ lines of Node.js
- Zero dependencies beyond what's already required (bash, tc)
- Faster than Node.js for simple operations
- Can still be called from test suites (via `spawn` or `exec`)
- Easier for users to read and modify if needed

## Implementation Details

### Script Structure

```bash
scripts/network-sim.sh {apply|reset|status|test}
```

**Subcommands:**
1. `apply` — Apply network conditions with validation
2. `reset` — Remove all rules (idempotent)
3. `status` — Show current active rules
4. `test <url>` — Measure latency to verify rules work

### Parameter Validation

| Parameter | Range | Validation Method |
|-----------|-------|-------------------|
| Latency | 0-500ms | Extract numeric part, convert to ms, check range |
| Loss | 0-30% | Extract numeric part, check range (support floats) |
| Jitter | 0-100ms | Extract numeric part, convert to ms, check range |

**Why these ranges?**
- Latency: 500ms is extremely high (satellite-level), higher values are unrealistic for testing
- Loss: 30% is severe packet loss, higher values make connection unusable
- Jitter: 100ms jitter is extreme, typical jitter is 5-20ms

### Safety Features

1. **Double-apply protection:** Check if netem rules exist before applying
   ```bash
   if has_active_rules; then
       error "Rules already active. Run reset first."
   fi
   ```

2. **Idempotent reset:** Reset succeeds even if no rules exist
   ```bash
   if ! has_active_rules; then
       info "No rules to remove (already clean)"
       return 0
   fi
   ```

3. **Parameter validation:** Reject invalid values before calling tc
   - Prevents cryptic tc error messages
   - Provides clear user-facing error messages

4. **Color-coded output:**
   - RED for errors
   - GREEN for success
   - YELLOW for warnings
   - Makes it clear when something went wrong

### Argument Parsing

Support both styles for flexibility:

**Positional (concise):**
```bash
./scripts/network-sim.sh apply 100ms 5% 10ms
```

**Named (clearer):**
```bash
./scripts/network-sim.sh apply --latency 100ms --loss 5% --jitter 10ms
```

**Partial specification:**
```bash
./scripts/network-sim.sh apply --latency 100ms
# Other parameters default to 0
```

### Testing Approach

Created `scripts/verify-network-sim.sh` to verify:
1. Initial state is clean
2. Rules can be applied
3. Rules are actually active (via tc qdisc show)
4. Double-apply protection works
5. Reset works
6. Cleanup is complete
7. Combined parameters work
8. Validation rejects invalid values
9. Idempotent reset works

**Note:** Verification requires sudo access. In automated CI without passwordless sudo, validation logic can be tested separately (as demonstrated in task implementation).

### Integration Points

**From test suite (JavaScript/TypeScript):**
```javascript
import { spawn } from 'child_process';

beforeAll(async () => {
  await spawnAsync('./scripts/network-sim.sh', ['apply', '--latency', '100ms']);
});

afterAll(async () => {
  await spawnAsync('./scripts/network-sim.sh', ['reset']);
});
```

**From bash test scripts:**
```bash
trap './scripts/network-sim.sh reset' EXIT
./scripts/network-sim.sh apply --latency 100ms
# Run tests...
# Cleanup happens via trap
```

## Documentation Strategy

**Updated `.claude/docs/network-simulation-setup.md` with:**
1. Full script usage examples
2. Parameter ranges and formats
3. Safety features explained
4. Common use cases (test reconnection, timeouts, prediction, packet loss)
5. Comprehensive troubleshooting section:
   - tc command not found
   - Reset failures
   - Rules won't apply
   - No latency change observed
   - Force cleanup procedure
   - Impact on other services
   - Persistence after reboot
6. Integration examples for test suites

**Troubleshooting section addresses:**
- Common error messages and their fixes
- How to verify rules are active
- Force cleanup if script fails
- Impact on other localhost services (important!)
- Rules persistence (cleared on reboot)

## Reversibility

**Easy** — Script can be deleted and users can go back to manual tc commands. All documentation includes raw tc commands for reference.

## Future Enhancements (Not Implemented)

**Bandwidth throttling:**
Could add `rate <limit>` parameter to simulate slow connections.
Decision: Deferred. Current use case focuses on latency/loss/jitter.

**Pre-defined profiles:**
Could add `./scripts/network-sim.sh apply --profile mobile-3g`
Decision: Deferred. Current parameters are explicit and clear.

**JSON output for programmatic parsing:**
Could add `--json` flag to status/test commands.
Decision: Deferred. Not needed yet.

## Files Changed

- `scripts/network-sim.sh` (NEW) — Main script (~300 lines)
- `scripts/verify-network-sim.sh` (NEW) — Verification tests (~200 lines)
- `.claude/docs/network-simulation-setup.md` (UPDATED) — Added 300+ lines of documentation

## Verification Level

**Level 2 — Validation Logic Tested**

- ✓ Script created and made executable
- ✓ Validation logic tested independently (600ms rejected, 500ms accepted, 31% loss rejected)
- ✓ Help output works
- ✗ Cannot test sudo operations without passwordless sudo setup
- ✗ Cannot measure actual latency in this session

**Next:** User must run `scripts/verify-network-sim.sh` with sudo to reach Level 3 (functional verification).

## Related Documentation

- Phase 1: `.claude/docs/network-simulation-setup.md` (research)
- Task file: `tasks/lan-s13-setup-network-simulation.md`
- Verification script: `scripts/verify-network-sim.sh`
