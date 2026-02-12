#!/bin/bash
#
# LAN Test Matrix Runner
# Runs comprehensive test matrix across different network conditions
#
# Usage:
#   ./run-lan-test-matrix.sh           # Optimized matrix (6 combinations, ~1 hour)
#   ./run-lan-test-matrix.sh --full    # Full matrix (16 combinations, ~3 hours)
#   ./run-lan-test-matrix.sh --quick   # Quick validation (3 combinations, ~30 min)
#
# Outputs:
#   - test-results/lan/matrix/*.json   (per-combination results)
#   - test-results/lan/matrix/*.log    (per-combination output)
#   - test-results/lan/matrix-summary.json (aggregated summary)
#   - test-screenshots/lan/matrix/*    (screenshots per combination)
#

set -euo pipefail

# Ensure sbin is in PATH (for tc command)
export PATH="/sbin:/usr/sbin:$PATH"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    echo -e "${BLUE}$1${NC}"
}

# Get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Output directories
MATRIX_DIR="$PROJECT_ROOT/test-results/lan/matrix"
SCREENSHOT_DIR="$PROJECT_ROOT/test-screenshots/lan/matrix"
mkdir -p "$MATRIX_DIR"
mkdir -p "$SCREENSHOT_DIR"

# Parse CLI arguments
MODE="optimized"
if [[ $# -gt 0 ]]; then
  case "$1" in
    --full)
      MODE="full"
      ;;
    --quick)
      MODE="quick"
      ;;
    --optimized)
      MODE="optimized"
      ;;
    *)
      error "Unknown option: $1. Use --full, --quick, or --optimized (default)"
      ;;
  esac
fi

# Define test matrices
declare -a LATENCIES
declare -a PACKET_LOSSES
declare -a JITTERS

case "$MODE" in
  full)
    info "Running FULL matrix (16 combinations, ~3 hours)"
    LATENCIES=(0 50 100 200)
    PACKET_LOSSES=(0 5 10)
    JITTERS=(0 10)
    ;;
  quick)
    info "Running QUICK validation matrix (3 combinations, ~30 min)"
    LATENCIES=(0 100)
    PACKET_LOSSES=(0 5)
    JITTERS=(0)
    ;;
  optimized)
    info "Running OPTIMIZED matrix (6 combinations, ~1 hour)"
    LATENCIES=(0 100 200)
    PACKET_LOSSES=(0 10)
    JITTERS=(0)
    ;;
esac

# Test timeout (5 minutes per combination)
TIMEOUT_MATRIX=300

# Check prerequisites
check_prerequisites() {
  info "Checking prerequisites..."

  # Check if running as sudo (required for tc)
  if [[ $EUID -ne 0 ]]; then
    error "This script must be run with sudo (required for network simulation via tc)"
  fi

  # Check if tc is available
  if ! command -v tc &> /dev/null; then
    error "tc command not found. Install iproute2 package."
  fi

  # Check if node is available
  if ! command -v node &> /dev/null; then
    error "node command not found. Install Node.js 20+"
  fi

  # Check if test harness exists
  if [[ ! -f "tests/lan/run-lan-tests.mjs" ]]; then
    error "Test harness not found: tests/lan/run-lan-tests.mjs"
  fi

  # Check if network-sim script exists
  if [[ ! -f "scripts/network-sim.sh" ]]; then
    error "Network simulation script not found: scripts/network-sim.sh"
  fi

  # Check if any servers are running
  if ss -tlnp 2>/dev/null | grep -qE ':(300[0-9]|2567)\b'; then
    warning "Found existing servers on ports 3000-3009 or 2567"
    warning "Attempting to kill them..."
    ss -tlnp 2>/dev/null | grep -E ':(300[0-9]|2567)\b' | awk '{print $NF}' | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -15 2>/dev/null || true
    sleep 2
  fi

  success "Prerequisites check passed"
}

# Reset network conditions (critical between tests)
reset_network() {
  info "Resetting network conditions..."
  bash scripts/network-sim.sh reset 2>/dev/null || warning "Failed to reset network (may be clean already)"
  sleep 1
}

# Run a single test combination
run_combination() {
  local latency=$1
  local loss=$2
  local jitter=$3

  local combo_name="${latency}ms-${loss}loss-${jitter}jitter"
  local output_log="$MATRIX_DIR/output-$combo_name.log"
  local result_json="$MATRIX_DIR/lan-test-$combo_name.json"

  info ""
  info "=========================================="
  info "Testing: ${latency}ms latency, ${loss}% packet loss, ${jitter}ms jitter"
  info "=========================================="

  # Reset network before each test
  reset_network

  # Build test command
  local test_cmd="node tests/lan/run-lan-tests.mjs"

  # Add network simulation flags if conditions are non-zero
  if [[ $latency -gt 0 ]] || [[ $loss -gt 0 ]] || [[ $jitter -gt 0 ]]; then
    test_cmd="$test_cmd --network-sim"
    test_cmd="$test_cmd --latency $latency"
    test_cmd="$test_cmd --packet-loss $loss"
    test_cmd="$test_cmd --jitter $jitter"
  fi

  # Run test with timeout
  local start_time=$(date +%s)
  local exit_code=0

  info "Running: $test_cmd"

  if timeout ${TIMEOUT_MATRIX} bash -c "$test_cmd > '$output_log' 2>&1"; then
    success "Test combination passed"
  else
    exit_code=$?
    if [[ $exit_code -eq 124 ]]; then
      error "Test combination TIMEOUT (exceeded ${TIMEOUT_MATRIX}s)"
      echo "TEST TIMEOUT" >> "$output_log"
    else
      warning "Test combination FAILED (exit code: $exit_code)"
    fi
  fi

  local end_time=$(date +%s)
  local duration=$((end_time - start_time))

  # Copy results to matrix directory
  if [[ -f "test-results/lan/lan-test-results.json" ]]; then
    cp "test-results/lan/lan-test-results.json" "$result_json"
    success "Results saved to: $result_json"
  else
    warning "No results file found for this combination"
    # Create a placeholder result file
    echo "{\"error\": \"Test failed or timed out\", \"duration\": $duration, \"exitCode\": $exit_code}" > "$result_json"
  fi

  # Copy screenshots
  if [[ -d "test-screenshots/lan" ]]; then
    local combo_screenshot_dir="$SCREENSHOT_DIR/$combo_name"
    mkdir -p "$combo_screenshot_dir"

    # Copy screenshots with network condition prefix
    if ls test-screenshots/lan/lan-*.png 1> /dev/null 2>&1; then
      cp test-screenshots/lan/lan-*.png "$combo_screenshot_dir/" 2>/dev/null || true
      success "Screenshots saved to: $combo_screenshot_dir"
    fi
  fi

  info "Duration: ${duration}s"

  # Reset network after test
  reset_network

  # Brief pause between combinations
  sleep 3
}

# Main execution
main() {
  info "LAN Test Matrix Runner"
  info "======================"
  info "Mode: $MODE"
  info "Output directory: $MATRIX_DIR"

  # Check prerequisites
  check_prerequisites

  # Reset network before starting
  reset_network

  # Count total combinations
  local baseline_combos=$((${#LATENCIES[@]} * ${#PACKET_LOSSES[@]}))
  local jitter_combos=0
  if [[ ${#JITTERS[@]} -gt 1 ]]; then
    jitter_combos=${#LATENCIES[@]}
  fi
  local total_combos=$((baseline_combos + jitter_combos))

  info "Total combinations: $total_combos"
  info "Estimated time: $((total_combos * 3 / 60)) - $((total_combos * 6 / 60)) hours"
  info ""

  local current_combo=0
  local start_time=$(date +%s)

  # Run baseline combinations (latency × packet loss, no jitter)
  for latency in "${LATENCIES[@]}"; do
    for loss in "${PACKET_LOSSES[@]}"; do
      current_combo=$((current_combo + 1))
      info "Progress: $current_combo / $total_combos"
      run_combination "$latency" "$loss" 0
    done
  done

  # Run jitter combinations if requested (one per latency level, 0% loss)
  if [[ ${#JITTERS[@]} -gt 1 ]]; then
    for latency in "${LATENCIES[@]}"; do
      for jitter in "${JITTERS[@]}"; do
        if [[ $jitter -gt 0 ]]; then
          current_combo=$((current_combo + 1))
          info "Progress: $current_combo / $total_combos"
          run_combination "$latency" 0 "$jitter"
        fi
      done
    done
  fi

  # Final network reset
  reset_network

  local end_time=$(date +%s)
  local total_duration=$((end_time - start_time))

  info ""
  success "=========================================="
  success "Matrix complete!"
  success "=========================================="
  info "Total combinations: $total_combos"
  info "Total duration: $((total_duration / 60)) minutes $((total_duration % 60)) seconds"
  info "Results directory: $MATRIX_DIR"
  info "Screenshots directory: $SCREENSHOT_DIR"
  info ""
  info "Next step: Generate summary with:"
  info "  node scripts/generate-matrix-summary.mjs"
}

# Run main function
main
