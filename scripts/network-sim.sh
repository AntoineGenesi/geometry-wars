#!/bin/bash
#
# Network Simulation Script for LAN Testing
# Uses tc qdisc netem to apply latency, packet loss, and jitter to localhost traffic
#
# Usage:
#   ./network-sim.sh apply 100ms 5% 10ms
#   ./network-sim.sh apply --latency 100ms --loss 5% --jitter 10ms
#   ./network-sim.sh reset
#   ./network-sim.sh status
#   ./network-sim.sh test <url>
#

set -euo pipefail

# Ensure sbin is in PATH (tc command location)
export PATH="/sbin:/usr/sbin:$PATH"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Defaults
LATENCY="0ms"
LOSS="0%"
JITTER="0ms"
INTERFACE="lo"

# Helper functions
error() {
    echo -e "${RED}ERROR: $1${NC}" >&2
    exit 1
}

success() {
    echo -e "${GREEN}$1${NC}"
}

warning() {
    echo -e "${YELLOW}WARNING: $1${NC}"
}

info() {
    echo "$1"
}

# Check if tc is available
check_tc() {
    if ! command -v tc &> /dev/null; then
        error "tc (traffic control) command not found. It should be built into the Linux kernel."
    fi
}

# Parse value and unit, validate range
validate_latency() {
    local value=$1
    # Extract numeric part
    local num="${value%ms}"
    num="${num%s}"

    if ! [[ "$num" =~ ^[0-9]+$ ]]; then
        error "Invalid latency format: $value (expected format: 100ms or 100s)"
    fi

    # Convert to milliseconds
    if [[ "$value" == *"s" ]] && [[ "$value" != *"ms" ]]; then
        num=$((num * 1000))
    fi

    if [ "$num" -lt 0 ] || [ "$num" -gt 500 ]; then
        error "Latency must be between 0-500ms (got ${num}ms)"
    fi
}

validate_loss() {
    local value=$1
    # Extract numeric part
    local num="${value%\%}"

    if ! [[ "$num" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
        error "Invalid loss format: $value (expected format: 5% or 5.5%)"
    fi

    # Check range (allow float comparison)
    if (( $(echo "$num < 0" | bc -l) )) || (( $(echo "$num > 30" | bc -l) )); then
        error "Packet loss must be between 0-30% (got ${num}%)"
    fi
}

validate_jitter() {
    local value=$1
    # Extract numeric part
    local num="${value%ms}"
    num="${num%s}"

    if ! [[ "$num" =~ ^[0-9]+$ ]]; then
        error "Invalid jitter format: $value (expected format: 10ms or 10s)"
    fi

    # Convert to milliseconds
    if [[ "$value" == *"s" ]] && [[ "$value" != *"ms" ]]; then
        num=$((num * 1000))
    fi

    if [ "$num" -lt 0 ] || [ "$num" -gt 100 ]; then
        error "Jitter must be between 0-100ms (got ${num}ms)"
    fi
}

# Check if rules already exist
has_active_rules() {
    local output
    output=$(sudo tc qdisc show dev "$INTERFACE" 2>&1 || true)

    # Check if netem is active
    if echo "$output" | grep -q "netem"; then
        return 0  # Rules exist
    else
        return 1  # No rules
    fi
}

# Apply network conditions
apply_rules() {
    check_tc

    # Safety check: prevent double-apply
    if has_active_rules; then
        error "Network simulation rules already active on $INTERFACE. Run '$0 reset' first."
    fi

    # Validate all parameters
    if [ "$LATENCY" != "0ms" ]; then
        validate_latency "$LATENCY"
    fi

    if [ "$LOSS" != "0%" ]; then
        validate_loss "$LOSS"
    fi

    if [ "$JITTER" != "0ms" ]; then
        validate_jitter "$JITTER"
    fi

    # Build tc command
    local cmd="sudo tc qdisc add dev $INTERFACE root netem"
    local conditions=()

    if [ "$LATENCY" != "0ms" ]; then
        if [ "$JITTER" != "0ms" ]; then
            conditions+=("delay $LATENCY $JITTER")
        else
            conditions+=("delay $LATENCY")
        fi
    fi

    if [ "$LOSS" != "0%" ]; then
        conditions+=("loss $LOSS")
    fi

    if [ ${#conditions[@]} -eq 0 ]; then
        error "No network conditions specified. Use --latency, --loss, or --jitter."
    fi

    # Join conditions
    cmd="$cmd ${conditions[*]}"

    info "Applying network simulation: ${conditions[*]}"

    if ! $cmd 2>&1; then
        error "Failed to apply tc rules. Do you have sudo access?"
    fi

    success "✓ Network simulation applied successfully"

    # Show what was applied
    status_rules
}

# Reset network conditions
reset_rules() {
    check_tc

    if ! has_active_rules; then
        info "No active network simulation rules on $INTERFACE (already clean)"
        return 0
    fi

    info "Removing network simulation rules from $INTERFACE..."

    if ! sudo tc qdisc del dev "$INTERFACE" root 2>&1; then
        error "Failed to remove tc rules. Do you have sudo access?"
    fi

    success "✓ Network simulation removed"

    # Verify it's clean
    local output
    output=$(sudo tc qdisc show dev "$INTERFACE")

    if echo "$output" | grep -q "netem"; then
        warning "Rules may still be active. Check with '$0 status'"
    else
        info "Interface $INTERFACE is clean (no qdisc rules)"
    fi
}

# Show current status
status_rules() {
    check_tc

    info "Current traffic control rules on $INTERFACE:"
    echo ""

    sudo tc qdisc show dev "$INTERFACE"
    echo ""

    if has_active_rules; then
        warning "Network simulation is ACTIVE on $INTERFACE"
        info "Run '$0 reset' to remove rules"
    else
        success "No network simulation active (clean)"
    fi
}

# Test latency to a URL
test_latency() {
    local url="${1:-}"

    if [ -z "$url" ]; then
        error "Usage: $0 test <url>"
    fi

    info "Testing latency to: $url"
    info "Running 10 ping attempts..."
    echo ""

    # Use curl to measure latency
    local total=0
    local count=10

    for i in $(seq 1 $count); do
        local start=$(date +%s%3N)

        if curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" > /dev/null 2>&1; then
            local end=$(date +%s%3N)
            local latency=$((end - start))
            echo "Attempt $i: ${latency}ms"
            total=$((total + latency))
        else
            warning "Attempt $i: Failed (timeout or connection error)"
        fi
    done

    local avg=$((total / count))
    echo ""
    success "Average latency: ${avg}ms"
}

# Parse command line arguments
cmd="${1:-}"

case "$cmd" in
    apply)
        shift

        # Support both positional and named arguments
        if [[ "${1:-}" == --* ]]; then
            # Named arguments (--latency 100ms --loss 5%)
            while [[ $# -gt 0 ]]; do
                case "$1" in
                    --latency)
                        LATENCY="$2"
                        shift 2
                        ;;
                    --loss)
                        LOSS="$2"
                        shift 2
                        ;;
                    --jitter)
                        JITTER="$2"
                        shift 2
                        ;;
                    *)
                        error "Unknown option: $1"
                        ;;
                esac
            done
        else
            # Positional arguments (latency loss jitter)
            LATENCY="${1:-0ms}"
            LOSS="${2:-0%}"
            JITTER="${3:-0ms}"
        fi

        apply_rules
        ;;

    reset)
        reset_rules
        ;;

    status)
        status_rules
        ;;

    test)
        shift
        test_latency "$@"
        ;;

    *)
        cat <<EOF
Usage: $0 {apply|reset|status|test}

Commands:
  apply <latency> <loss> <jitter>
      Apply network simulation with positional arguments
      Example: $0 apply 100ms 5% 10ms

  apply --latency <ms> --loss <percent> --jitter <ms>
      Apply network simulation with named arguments
      Example: $0 apply --latency 100ms --loss 5% --jitter 10ms

  reset
      Remove all network simulation rules

  status
      Show current active rules

  test <url>
      Test latency to a URL (HTTP)
      Example: $0 test http://localhost:2567

Parameters:
  latency: 0-500ms (e.g., 100ms, 0.1s)
  loss:    0-30%   (e.g., 5%, 2.5%)
  jitter:  0-100ms (e.g., 10ms, 0.01s)

Examples:
  # Apply 100ms latency
  $0 apply 100ms 0% 0ms
  $0 apply --latency 100ms

  # Apply 100ms latency with 10ms jitter and 5% packet loss
  $0 apply 100ms 5% 10ms
  $0 apply --latency 100ms --loss 5% --jitter 10ms

  # Check what's active
  $0 status

  # Remove all rules
  $0 reset

  # Test latency to Colyseus server
  $0 test http://localhost:2567
EOF
        exit 1
        ;;
esac
