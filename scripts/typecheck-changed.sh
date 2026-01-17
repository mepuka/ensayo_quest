#!/bin/bash
#
# Typecheck only changed TypeScript files.
# Works around the stack overflow issue with full-project typecheck.
#
# Usage:
#   ./scripts/typecheck-changed.sh          # Check staged + unstaged changes
#   ./scripts/typecheck-changed.sh --staged # Check only staged files
#   ./scripts/typecheck-changed.sh --all    # Check all files changed vs main
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Ensure we're using Node 22 via fnm if available
if command -v fnm &> /dev/null; then
  eval "$(fnm env)" 2>/dev/null
  fnm use 22 --silent-if-unchanged 2>/dev/null || true
fi

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${YELLOW}Warning: Node $NODE_VERSION detected. Node 22 recommended.${NC}"
  echo "Install fnm and run: fnm install 22 && fnm use 22"
fi

# Determine which files to check based on argument
case "${1:-}" in
  --staged)
    FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' || true)
    MODE="staged"
    ;;
  --all)
    # All changes vs main branch
    FILES=$(git diff --name-only main...HEAD | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' || true)
    MODE="vs main"
    ;;
  *)
    # Both staged and unstaged
    FILES=$(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' || true)
    MODE="changed"
    ;;
esac

if [ -z "$FILES" ]; then
  echo -e "${GREEN}No TypeScript files to check ($MODE).${NC}"
  exit 0
fi

FILE_COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
echo -e "Checking ${YELLOW}$FILE_COUNT${NC} $MODE TypeScript file(s)..."

# Increase stack limit on macOS
ulimit -s 65520 2>/dev/null || true

# Run tsc on changed files with increased stack
# Note: This checks files individually which uses tsconfig.json settings
ERRORS=""
EXIT_CODE=0

for file in $FILES; do
  if [ -f "$file" ]; then
    OUTPUT=$(node --stack-size=32768 ./node_modules/typescript/bin/tsc --noEmit "$file" 2>&1 || true)
    # Filter out Effect Utils.d.ts noise and extract real errors
    FILE_ERRORS=$(echo "$OUTPUT" | grep -E "^$file.*: error TS" || true)
    if [ -n "$FILE_ERRORS" ]; then
      ERRORS="$ERRORS$FILE_ERRORS\n"
      EXIT_CODE=1
    fi
  fi
done

if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}All $FILE_COUNT file(s) passed typecheck.${NC}"
else
  echo -e "\n${RED}Type errors found:${NC}"
  echo -e "$ERRORS"
  exit 1
fi
