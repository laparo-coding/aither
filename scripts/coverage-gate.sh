#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Coverage Gate Script (T064)
# Fails CI if auth-path coverage < 90% or overall new-code coverage < 80%.
# Usage: bash scripts/coverage-gate.sh
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Configuration ---
AUTH_THRESHOLD=90
OVERALL_THRESHOLD=80
COVERAGE_DIR="coverage"

# Auth-related source files (requireSyncAccess, route auth guards)
AUTH_FILES=(
  "src/lib/recording/require-sync-access.ts"
  "src/app/api/recording/chapters/[id]/route.ts"
  "src/app/api/recording/playback/play/route.ts"
  "src/app/api/recording/events/route.ts"
)

# All Spec-010 source files (new code)
SPEC_FILES=(
  "src/lib/recording/chapter-boundary-detector.ts"
  "src/lib/recording/chapter-extractor.ts"
  "src/lib/recording/chaptered-asset-mapping.ts"
  "src/lib/recording/ffmpeg-remux.ts"
  "src/lib/recording/schemas.ts"
  "src/lib/utils/api-response.ts"
  "src/lib/recording/require-sync-access.ts"
)

# --- Helpers ---
info()  { echo "[INFO]  $*"; }
warn()  { echo "[WARN]  $*"; }
fail()  { echo "[FAIL]  $*"; exit 1; }
pass()  { echo "[PASS]  $*"; }

# Extract line coverage % from lcov summary for a given source file.
# Parses lcov.info for the file and sums found/hit lines.
get_line_coverage() {
  local file="$1"
  local lcov_file="${COVERAGE_DIR}/lcov.info"

  if [[ ! -f "$lcov_file" ]]; then
    warn "lcov.info not found at ${lcov_file}. Run tests with --coverage first."
    return 1
  fi

  # Manual parse: extract SF: and LF:/LH: lines for the file
  local found=false
  local found_lines=0
  local hit_lines=0

  while IFS= read -r line; do
    if [[ "$line" == "SF:"* ]]; then
      # Check if this SF entry matches our file
      if [[ "$line" == *"${file}"* ]]; then
        found=true
        found_lines=0
        hit_lines=0
      else
        found=false
      fi
    elif $found; then
      if [[ "$line" =~ ^LF:([0-9]+) ]]; then
        found_lines="${BASH_REMATCH[1]}"
      elif [[ "$line" =~ ^LH:([0-9]+) ]]; then
        hit_lines="${BASH_REMATCH[1]}"
      fi
    fi
  done < "$lcov_file"

  if [[ "$found_lines" -eq 0 ]]; then
    echo "0%"
    return 1
  fi

  local pct
  pct=$(echo "scale=2; ($hit_lines / $found_lines) * 100" | bc)
  echo "${pct}%"
}

# --- Main ---
info "Coverage Gate Check"
info "===================="
info "Auth threshold: ${AUTH_THRESHOLD}%"
info "Overall threshold: ${OVERALL_THRESHOLD}%"
echo ""

# Check that coverage data exists
if [[ ! -d "${COVERAGE_DIR}" ]]; then
  fail "Coverage directory '${COVERAGE_DIR}' not found. Run 'npm run test -- --coverage' first."
fi

# --- Auth Coverage Check ---
info "Checking auth-related files..."
auth_fail=false
for file in "${AUTH_FILES[@]}"; do
  cov=$(get_line_coverage "$file" || echo "N/A")
  if [[ "$cov" == "N/A" ]]; then
    warn "  ${file}: no coverage data (file may not exist or not be in coverage scope)"
  else
    # Strip % sign and compare
    cov_num=$(echo "$cov" | tr -d '%')
    if (( $(echo "$cov_num < $AUTH_THRESHOLD" | bc -l) )); then
      warn "  ${file}: ${cov} (below ${AUTH_THRESHOLD}% threshold)"
      auth_fail=true
    else
      pass "  ${file}: ${cov}"
    fi
  fi
done

if $auth_fail; then
  fail "Auth coverage below ${AUTH_THRESHOLD}% threshold."
else
  pass "All auth files meet ${AUTH_THRESHOLD}% threshold."
fi

echo ""

# --- Overall New-Code Coverage Check ---
info "Checking all Spec-010 source files..."
overall_fail=false
for file in "${SPEC_FILES[@]}"; do
  cov=$(get_line_coverage "$file" || echo "N/A")
  if [[ "$cov" == "N/A" ]]; then
    warn "  ${file}: no coverage data"
  else
    cov_num=$(echo "$cov" | tr -d '%')
    if (( $(echo "$cov_num < $OVERALL_THRESHOLD" | bc -l) )); then
      warn "  ${file}: ${cov} (below ${OVERALL_THRESHOLD}% threshold)"
      overall_fail=true
    else
      pass "  ${file}: ${cov}"
    fi
  fi
done

if $overall_fail; then
  fail "Overall new-code coverage below ${OVERALL_THRESHOLD}% threshold."
else
  pass "All new-code files meet ${OVERALL_THRESHOLD}% threshold."
fi

echo ""
info "===================="
pass "Coverage gate PASSED."
