#!/bin/bash
#
# Verification Test for network-sim.sh
# Requires sudo access for tc commands
#
# This script:
# 1. Tests that rules can be applied
# 2. Verifies rules are actually active
# 3. Tests that reset works
# 4. Verifies cleanup is complete
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_SIM="$SCRIPT_DIR/network-sim.sh"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓ $1${NC}"; }
error() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}→ $1${NC}"; }

# Ensure cleanup on exit
cleanup() {
    info "Cleaning up..."
    "$NETWORK_SIM" reset > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "======================================"
echo "Network Simulation Verification Tests"
echo "======================================"
echo ""

# Test 1: Status shows clean state
info "Test 1: Initial state should be clean"
if "$NETWORK_SIM" status 2>&1 | grep -q "No network simulation active"; then
    success "Initial state is clean"
else
    error "Initial state is not clean - run '$NETWORK_SIM reset' first"
fi
echo ""

# Test 2: Apply 100ms latency
info "Test 2: Apply 100ms latency"
if "$NETWORK_SIM" apply --latency 100ms > /dev/null 2>&1; then
    success "Applied 100ms latency"
else
    error "Failed to apply 100ms latency"
fi

# Verify rules are active
if sudo tc qdisc show dev lo | grep -q "netem"; then
    success "Verified netem rules are active"
else
    error "Rules should be active but netem not found"
fi

# Verify latency value
if sudo tc qdisc show dev lo | grep -q "delay 100ms"; then
    success "Verified delay is 100ms"
else
    error "Delay value is not 100ms as expected"
fi
echo ""

# Test 3: Double-apply protection
info "Test 3: Test double-apply protection"
if "$NETWORK_SIM" apply --latency 50ms 2>&1 | grep -q "already active"; then
    success "Double-apply protection works"
else
    error "Double-apply protection failed"
fi
echo ""

# Test 4: Reset rules
info "Test 4: Reset network simulation"
if "$NETWORK_SIM" reset > /dev/null 2>&1; then
    success "Reset completed"
else
    error "Reset failed"
fi

# Verify cleanup
if ! sudo tc qdisc show dev lo | grep -q "netem"; then
    success "Verified rules are removed"
else
    error "Rules still active after reset"
fi
echo ""

# Test 5: Apply with multiple parameters
info "Test 5: Apply latency + jitter + loss"
if "$NETWORK_SIM" apply --latency 100ms --jitter 10ms --loss 5% > /dev/null 2>&1; then
    success "Applied combined parameters"
else
    error "Failed to apply combined parameters"
fi

# Verify all parameters
OUTPUT=$(sudo tc qdisc show dev lo details)
if echo "$OUTPUT" | grep -q "delay 100ms"; then
    success "Verified latency parameter"
else
    error "Latency parameter not found"
fi

if echo "$OUTPUT" | grep -q "10ms"; then
    success "Verified jitter parameter"
else
    error "Jitter parameter not found"
fi

if echo "$OUTPUT" | grep -q "loss 5%"; then
    success "Verified loss parameter"
else
    error "Loss parameter not found"
fi

"$NETWORK_SIM" reset > /dev/null 2>&1
echo ""

# Test 6: Parameter validation
info "Test 6: Parameter validation"

# Test invalid latency (> 500ms)
if "$NETWORK_SIM" apply 600ms 0% 0ms 2>&1 | grep -q "Latency must be between 0-500ms"; then
    success "Latency validation works (rejected 600ms)"
else
    error "Latency validation failed"
fi

# Test invalid loss (> 30%)
if "$NETWORK_SIM" apply 100ms 35% 0ms 2>&1 | grep -q "Packet loss must be between 0-30%"; then
    success "Loss validation works (rejected 35%)"
else
    error "Loss validation failed"
fi

# Test invalid jitter (> 100ms)
if "$NETWORK_SIM" apply 100ms 0% 150ms 2>&1 | grep -q "Jitter must be between 0-100ms"; then
    success "Jitter validation works (rejected 150ms)"
else
    error "Jitter validation failed"
fi
echo ""

# Test 7: Idempotent reset
info "Test 7: Idempotent reset (reset when already clean)"
"$NETWORK_SIM" reset > /dev/null 2>&1
if "$NETWORK_SIM" reset 2>&1 | grep -q "already clean"; then
    success "Idempotent reset works"
else
    error "Reset should be idempotent"
fi
echo ""

echo "======================================"
echo -e "${GREEN}All verification tests passed!${NC}"
echo "======================================"
echo ""
echo "The network-sim.sh script is ready to use."
echo "Next step: Measure actual latency with './scripts/network-sim.sh test <url>'"
