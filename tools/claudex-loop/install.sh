#!/usr/bin/env bash
# מתקין את התוסף Claudex Loop ל-Claude Code ברמת המשתמש,
# ומוסיף את כלל ההפעלה ל-~/.claude/CLAUDE.md כדי שיחול בכל פרויקט.
# בטוח להרצה חוזרת: הבלוק הקודם מוחלף, וגיבוי נשמר לפני כל שינוי.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULE_FILE="$SCRIPT_DIR/claudex-rule.md"
CLAUDE_MD="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md"

command -v claude >/dev/null || { echo "claude CLI not found - install Claude Code first" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found - Claudex Loop needs Python 3.10+" >&2; exit 1; }

claude plugin marketplace add chaseai-yt/claudex-loop
claude plugin install claudex-loop@claudex-loop

mkdir -p "$(dirname "$CLAUDE_MD")"
[ -f "$CLAUDE_MD" ] && cp "$CLAUDE_MD" "$CLAUDE_MD.bak-claudex"

python3 -I - "$CLAUDE_MD" "$RULE_FILE" <<'PY'
import re, sys
from pathlib import Path

target, rule = Path(sys.argv[1]), Path(sys.argv[2]).read_text(encoding="utf-8").strip()
start, end = "<!-- claudex-loop:start -->", "<!-- claudex-loop:end -->"
text = target.read_text(encoding="utf-8") if target.exists() else ""
text = re.sub(re.escape(start) + r".*?" + re.escape(end), "", text, flags=re.S).rstrip()
block = f"{start}\n{rule}\n{end}\n"
target.write_text(f"{text}\n\n{block}" if text else block, encoding="utf-8")
PY
echo "Rule written to $CLAUDE_MD"

if command -v codex >/dev/null; then
  codex --version
  codex login status || echo "Codex is installed but not logged in - run: codex login"
else
  echo "Codex CLI not found - run: npm install -g @openai/codex && codex login"
fi
