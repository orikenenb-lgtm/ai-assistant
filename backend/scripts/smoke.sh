#!/usr/bin/env bash
# בדיקות עשן — חובה לפני כל deploy ומיד אחריו.
# שימוש: ./scripts/smoke.sh [BASE_URL]   (ברירת מחדל: http://localhost:8000)
set -u

BASE_URL="${1:-http://localhost:8000}"
FAILURES=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "✅ $name ($actual)"
  else
    echo "❌ $name — צפוי $expected, התקבל $actual"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "🔍 בדיקות עשן מול: $BASE_URL"
echo "-----------------------------------"

# 1. השרת חי
check "GET /health" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE_URL/health")"

# 2. auth חי (קלט ריק → ולידציה, לא קריסה)
check "POST /auth/login מגיב" "422" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST "$BASE_URL/auth/login" \
     -H 'Content-Type: application/json' -d '{}')"

# 3. הקטלוג מוגן ומגיב
check "GET /products דורש התחברות" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE_URL/products")"

# 4. הזמנות מוגנות ומגיבות
check "POST /orders דורש התחברות" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST "$BASE_URL/orders" \
     -H 'Content-Type: application/json' -d '{"items":[]}')"

# 5. נתיבי אדמין מוגנים
check "POST /admin/sync דורש התחברות" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST "$BASE_URL/admin/sync" \
     -H 'Content-Type: application/json' -d '{}')"

# 6. (אופציונלי) עם ADMIN_TOKEN: חיבור Supabase + Rivhit dry-run אמיתיים
if [ -n "${ADMIN_TOKEN:-}" ]; then
  check "GET /auth/me עם טוקן אדמין" "200" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE_URL/auth/me" \
       -H "Authorization: Bearer $ADMIN_TOKEN")"
  check "Rivhit dry-run מגיב" "200" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE_URL/admin/sync" \
       -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
       -d '{"sync_type":"products","dry_run":true}')"
else
  echo "ℹ️  ADMIN_TOKEN לא הוגדר — דילוג על בדיקות מאומתות (Supabase + Rivhit dry-run)"
fi

echo "-----------------------------------"
if [ "$FAILURES" -eq 0 ]; then
  echo "🎉 כל בדיקות העשן עברו"
  exit 0
else
  echo "🚨 $FAILURES בדיקות נכשלו — אל תעלה לאוויר!"
  exit 1
fi
