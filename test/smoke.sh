#!/bin/zsh
# End-to-end smoke test against a live LM Studio server.
# Usage: test/smoke.sh   (starts the server via local-claude if it isn't up)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${SMITH_BASE_URL:-http://localhost:1234}"

if ! curl -s -m 3 "$BASE_URL/v1/models" >/dev/null; then
  echo "smoke: LM Studio not reachable, trying local-claude/server.sh start"
  "$HOME/src/local-claude/server.sh" start || {
    echo "smoke: FAIL — could not start LM Studio"; exit 1
  }
fi

WORK=$(mktemp -d /tmp/smith-smoke-XXXXXX)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

cat > greet.py <<'EOF'
def greet(name):
    # TODO: capitalize the name before greeting
    return f"hello {name}"
EOF
echo "The magic word is: xylophone-42" > notes.txt

pass=0; fail=0
check() {
  local label="$1"; shift
  if "$@"; then echo "smoke: PASS — $label"; pass=$((pass+1));
  else echo "smoke: FAIL — $label"; fail=$((fail+1)); fi
}

echo "--- task 1: read + answer"
out1=$(bun "$ROOT/src/index.ts" -p "Read notes.txt and tell me the magic word." 2>&1)
echo "$out1" | tail -3
check "answer contains magic word" grep -qi "xylophone-42" <<<"$out1"

echo "--- task 2: grep + edit"
out2=$(bun "$ROOT/src/index.ts" --yes -p "Find the TODO comment in this directory and fix it: make greet() capitalize the name using .capitalize(). Edit the file." 2>&1)
echo "$out2" | tail -3
check "greet.py was edited to capitalize" grep -q "capitalize()" greet.py

echo "--- task 3: bash + report"
out3=$(bun "$ROOT/src/index.ts" --yes -p "Run 'python3 -c \"print(2**10)\"' with Bash and tell me the result." 2>&1)
echo "$out3" | tail -3
check "reported 1024" grep -q "1024" <<<"$out3"

echo
echo "smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
