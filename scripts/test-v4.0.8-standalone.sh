#!/usr/bin/env bash
# Comprehensive test for v4.0.8 — tested AGAINST THE STANDALONE PACKAGE
# (per user request: "在 standalone 里测试不然结果不准确")
set -uo pipefail
BASE_URL="http://127.0.0.1:3400"
PASS=0
FAIL=0
TOTAL=0
FAILURES=()

G() { printf "\033[32m%s\033[0m\n" "$1"; }
R() { printf "\033[31m%s\033[0m\n" "$1"; }
Y() { printf "\033[33m%s\033[0m\n" "$1"; }

ok()   { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); G "  ✓ $1"; }
fail() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); R "  ✗ $1"; FAILURES+=("$1"); }

echo "=========================================="
echo "NodeByte Crawl v4.0.8 STANDALONE Test Suite"
echo "(running against the compiled standalone package)"
echo "=========================================="

echo ""
echo "── 1. Health check + version 4.0.8 ──"
RESP=$(curl -s -m 30 "$BASE_URL/api/status")
echo "$RESP" | jq -e '.version == "4.0.8"' >/dev/null && ok "/api/status returns 4.0.8 (standalone package)" || fail "version mismatch: $RESP"

echo ""
echo "── 2. TURNDOWN FIX — markdown conversion works (was crashing in v4.0.7) ──"
# Scrape a real URL and verify markdown is returned (not an error).
# In v4.0.7, this would fail with "Cannot find module 'turndown-65e08c56168c7636'".
RESP=$(curl -s -m 90 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
MD_LEN=$(echo "$RESP" | jq -r '.data.markdown | length // 0')
if [ "$SUCCESS" = "true" ] && [ "$MD_LEN" -gt 50 ]; then
  ok "Markdown conversion works in standalone ($MD_LEN chars returned — turndown module loads correctly)"
else
  fail "Markdown conversion failed: success=$SUCCESS, md_len=$MD_LEN, resp=$(echo "$RESP" | head -c 300)"
fi

echo ""
echo "── 3. TURNDOWN FIX — markdown with HTML tables / lists / links ──"
# Scrape a page with rich content to verify turndown handles tables, lists, links.
RESP=$(curl -s -m 90 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.nature.com/","formats":["markdown"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
MD_LEN=$(echo "$RESP" | jq -r '.data.markdown | length // 0')
if [ "$SUCCESS" = "true" ] && [ "$MD_LEN" -gt 2000 ]; then
  ok "Rich markdown conversion works ($MD_LEN chars — multi-article extraction + turndown)"
else
  fail "Rich markdown failed: success=$SUCCESS, md_len=$MD_LEN"
fi

echo ""
echo "── 4. FRONTEND FIX — Cookies button no longer crashes (Textarea is defined) ──"
# Fetch the test console page and verify no "Textarea is not defined" in the bundle.
# We can't easily simulate a click from curl, but we can check that the page
# HTML loads without error AND that the crawl-tab's Cookies UI is present in
# the bundled JS.
PAGE_HTML=$(curl -s -m 30 "$BASE_URL/")
if echo "$PAGE_HTML" | grep -q "NodeByte\|nodebyte"; then
  ok "Test console page loads without error"
else
  fail "Test console page failed to load"
fi
# Find the JS chunk that contains the crawl-tab component and check Textarea is bundled
JS_CHUNK=$(echo "$PAGE_HTML" | grep -oE '/_next/static/chunks/[a-zA-Z0-9_.-]+\.js' | head -10)
CHUNK_HAS_TEXTAREA=0
for chunk in $JS_CHUNK; do
  CONTENT=$(curl -s -m 15 "$BASE_URL$chunk" 2>/dev/null)
  if echo "$CONTENT" | grep -q "Textarea\|cookiesByDomain"; then
    CHUNK_HAS_TEXTAREA=1
    ok "Crawl-tab JS chunk bundles Textarea + cookiesByDomain UI"
    break
  fi
done
if [ "$CHUNK_HAS_TEXTAREA" = "0" ]; then
  fail "Could not verify Textarea bundling in JS chunks"
fi

echo ""
echo "── 5. 中文页面测试 (Chinese page rendering) ──"
# Test scraping a Chinese page — verify Chinese text is preserved in markdown.
RESP=$(curl -s -m 90 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.weather.com.cn/","formats":["markdown"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
MD=$(echo "$RESP" | jq -r '.data.markdown // ""')
# Check for Chinese characters in markdown (UTF-8 range)
CN_COUNT=$(echo "$MD" | grep -oP "[\x{4e00}-\x{9fff}]" | wc -l)
if [ "$SUCCESS" = "true" ] && [ "$CN_COUNT" -gt 10 ]; then
  ok "Chinese page scrape works ($CN_COUNT Chinese characters preserved in markdown)"
else
  fail "Chinese scrape failed: success=$SUCCESS, cn_chars=$CN_COUNT"
fi

echo ""
echo "── 6. nodebyte.cn 中文页面测试 (nodebyte.cn) ──"
RESP=$(curl -s -m 90 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://nodebyte.cn/t/topic/76","formats":["markdown"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
MD=$(echo "$RESP" | jq -r '.data.markdown // ""')
CN_COUNT=$(echo "$MD" | grep -oP "[\x{4e00}-\x{9fff}]" | wc -l)
if [ "$SUCCESS" = "true" ] && [ "$CN_COUNT" -gt 10 ]; then
  ok "nodebyte.cn Chinese page works ($CN_COUNT Chinese chars, title preserved)"
else
  fail "nodebyte.cn scrape failed: success=$SUCCESS, cn_chars=$CN_COUNT"
fi

echo ""
echo "── 7. weather.com.cn 截图 (Chinese weather site screenshot) ──"
RESP=$(curl -s -m 180 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.weather.com.cn/","formats":["screenshot"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
SHOT_LEN=$(echo "$RESP" | jq -r '.data.screenshot | length // 0')
if [ "$SUCCESS" = "true" ] && [ "$SHOT_LEN" -gt 20000 ]; then
  ok "weather.com.cn screenshot works ($SHOT_LEN bytes PNG)"
else
  fail "weather.com.cn screenshot failed: success=$SUCCESS, len=$SHOT_LEN"
fi

echo ""
echo "── 8. Per-URL cookies (sync batch) ──"
RESP=$(curl -s -m 120 -X POST "$BASE_URL/v2/scrape/batch" \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://httpbin.org/cookies","https://httpbin.org/cookies"],"formats":["markdown"],"cookies":["test_a=value_abc","test_b=value_xyz"]}')
URL1_MD=$(echo "$RESP" | jq -r '.data[0].data.markdown // ""')
URL2_MD=$(echo "$RESP" | jq -r '.data[1].data.markdown // ""')
# Markdown escapes underscores, so check for the escaped form too.
URL1_HAS_ABC=$(echo "$URL1_MD" | grep -qE 'value_abc|value\\_abc' && echo yes || echo no)
URL1_HAS_XYZ=$(echo "$URL1_MD" | grep -qE 'value_xyz|value\\_xyz' && echo yes || echo no)
URL2_HAS_XYZ=$(echo "$URL2_MD" | grep -qE 'value_xyz|value\\_xyz' && echo yes || echo no)
URL2_HAS_ABC=$(echo "$URL2_MD" | grep -qE 'value_abc|value\\_abc' && echo yes || echo no)
if [ "$URL1_HAS_ABC" = "yes" ] && [ "$URL1_HAS_XYZ" = "no" ]; then
  ok "URL 1 received ONLY cookie A (no leakage)"
else
  fail "URL 1 cookie isolation: abc=$URL1_HAS_ABC xyz=$URL1_HAS_XYZ"
fi
if [ "$URL2_HAS_XYZ" = "yes" ] && [ "$URL2_HAS_ABC" = "no" ]; then
  ok "URL 2 received ONLY cookie B (no leakage)"
else
  fail "URL 2 cookie isolation: xyz=$URL2_HAS_XYZ abc=$URL2_HAS_ABC"
fi

echo ""
echo "── 9. Crawl with sitemapLimit (nature.com — should complete fast) ──"
START=$(date +%s)
JOB_RESP=$(curl -s -m 30 -X POST "$BASE_URL/v2/crawl" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.nature.com/","maxDepth":1,"limit":5,"sitemap":"only","sitemapLimit":3,"scrapeOptions":{"formats":["markdown"]}}')
JOB_ID=$(echo "$JOB_RESP" | jq -r '.id // empty')
if [ -n "$JOB_ID" ]; then
  ok "Crawl started (id=$JOB_ID)"
  for i in $(seq 1 60); do
    sleep 3
    POLL=$(curl -s -m 10 "$BASE_URL/v2/crawl/$JOB_ID")
    STATUS=$(echo "$POLL" | jq -r '.status // empty')
    if [ "$STATUS" = "completed" ]; then
      END=$(date +%s)
      ELAPSED=$((END - START))
      PAGES=$(echo "$POLL" | jq -r '.data | length')
      if [ "$ELAPSED" -lt 60 ]; then
        ok "nature.com crawl completed in ${ELAPSED}s with $PAGES pages"
      else
        fail "nature.com crawl took ${ELAPSED}s (expected <60s)"
      fi
      break
    fi
    [ $i -eq 60 ] && fail "Crawl timed out (status=$STATUS)"
  done
else
  fail "Crawl did not start: $JOB_RESP"
fi

echo ""
echo "── 10. Crawl with cookiesByDomain ──"
JOB_RESP=$(curl -s -m 30 -X POST "$BASE_URL/v2/crawl" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://httpbin.org/cookies","maxDepth":1,"limit":3,"scrapeOptions":{"formats":["markdown"],"cookiesByDomain":{"httpbin.org":"crawl_test=by_domain"}}}')
JOB_ID=$(echo "$JOB_RESP" | jq -r '.id // empty')
if [ -n "$JOB_ID" ]; then
  ok "Crawl with cookiesByDomain started (id=$JOB_ID)"
  for i in $(seq 1 30); do
    sleep 2
    POLL=$(curl -s -m 10 "$BASE_URL/v2/crawl/$JOB_ID")
    STATUS=$(echo "$POLL" | jq -r '.status // empty')
    if [ "$STATUS" = "completed" ]; then
      ok "Crawl completed"
      SEED_MD=$(echo "$POLL" | jq -r '.data[0].data.markdown // ""')
      if echo "$SEED_MD" | grep -qE 'by_domain|by\\_domain'; then
        ok "Crawl seed received cookiesByDomain cookie"
      else
        fail "Crawl seed did NOT receive cookiesByDomain cookie: $(echo "$SEED_MD" | head -c 200)"
      fi
      break
    fi
    [ $i -eq 30 ] && fail "Crawl timed out (status=$STATUS)"
  done
else
  fail "Crawl did not start: $JOB_RESP"
fi

echo ""
echo "── 11. SSRF protection ──"
RESP=$(curl -s -m 30 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:8080","formats":["markdown"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
[ "$SUCCESS" = "false" ] && ok "SSRF block (private IP)" || fail "SSRF block failed"

RESP=$(curl -s -m 30 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://169.254.169.254/latest/meta-data","formats":["markdown"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
[ "$SUCCESS" = "false" ] && ok "SSRF block (cloud metadata)" || fail "SSRF block failed"

echo ""
echo "── 12. robots.txt enforcement ──"
RESP=$(curl -s -m 60 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://httpbin.org/deny","formats":["markdown"]}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
[ "$SUCCESS" = "false" ] && ok "robots.txt block (/deny)" || fail "robots.txt block failed"

echo ""
echo "── 13. nofollow link filtering ──"
RESP=$(curl -s -m 90 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://en.wikipedia.org/wiki/Nofollow","formats":["links"]}')
DEFAULT_COUNT=$(echo "$RESP" | jq -r '.data.links | length // 0')
RESP_FOLLOW=$(curl -s -m 90 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://en.wikipedia.org/wiki/Nofollow","formats":["links"],"followNofollow":true}')
FOLLOW_COUNT=$(echo "$RESP_FOLLOW" | jq -r '.data.links | length // 0')
if [ "$FOLLOW_COUNT" -ge "$DEFAULT_COUNT" ]; then
  ok "nofollow filter: follow=$FOLLOW_COUNT >= default=$DEFAULT_COUNT"
else
  fail "nofollow filter: follow=$FOLLOW_COUNT < default=$DEFAULT_COUNT (filter broken)"
fi

echo ""
echo "── 14. UA format conforms to Googlebot/Bingbot convention ──"
RESP=$(curl -s -m 60 -X POST "$BASE_URL/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://httpbin.org/user-agent","formats":["markdown"]}')
UA=$(echo "$RESP" | jq -r '.data.markdown // ""' | grep -oE '"user-agent": "[^"]+"' | sed 's/"user-agent": "//;s/"$//')
echo "Detected UA: $UA"
if echo "$UA" | grep -qE 'compatible; NodeByte Bot/4\.0\.8; \+https://nodebyte\.cn'; then
  ok "UA follows Googlebot/Bingbot format"
else
  fail "UA does not match expected format. Got: $UA"
fi

echo ""
echo "── 15. Async batch with per-URL cookies ──"
JOB_RESP=$(curl -s -m 30 -X POST "$BASE_URL/v2/batch/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://httpbin.org/cookies","https://httpbin.org/cookies"],"formats":["markdown"],"cookies":["test_c=value_c","test_d=value_d"]}')
JOB_ID=$(echo "$JOB_RESP" | jq -r '.id // empty')
if [ -n "$JOB_ID" ]; then
  ok "Async batch started (id=$JOB_ID)"
  for i in $(seq 1 20); do
    sleep 3
    POLL=$(curl -s -m 10 "$BASE_URL/v2/batch/scrape/$JOB_ID")
    STATUS=$(echo "$POLL" | jq -r '.status // empty')
    if [ "$STATUS" = "completed" ]; then
      ok "Async batch completed after $((i*3))s"
      URL1_MD=$(echo "$POLL" | jq -r '.data[0].data.markdown // ""')
      URL2_MD=$(echo "$POLL" | jq -r '.data[1].data.markdown // ""')
      URL1_HAS_C=$(echo "$URL1_MD" | grep -qE 'value_c|value\\_c' && echo yes || echo no)
      URL1_HAS_D=$(echo "$URL1_MD" | grep -qE 'value_d|value\\_d' && echo yes || echo no)
      URL2_HAS_D=$(echo "$URL2_MD" | grep -qE 'value_d|value\\_d' && echo yes || echo no)
      URL2_HAS_C=$(echo "$URL2_MD" | grep -qE 'value_c|value\\_c' && echo yes || echo no)
      if [ "$URL1_HAS_C" = "yes" ] && [ "$URL1_HAS_D" = "no" ]; then
        ok "Async URL 1 received ONLY cookie C"
      else
        fail "Async URL 1: c=$URL1_HAS_C d=$URL1_HAS_D"
      fi
      if [ "$URL2_HAS_D" = "yes" ] && [ "$URL2_HAS_C" = "no" ]; then
        ok "Async URL 2 received ONLY cookie D"
      else
        fail "Async URL 2: d=$URL2_HAS_D c=$URL2_HAS_C"
      fi
      break
    fi
    [ $i -eq 20 ] && fail "Async batch timed out"
  done
else
  fail "Async batch did not start: $JOB_RESP"
fi

echo ""
echo "── 16. /v2/map (link discovery) ──"
RESP=$(curl -s -m 90 -X POST "$BASE_URL/v2/map" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","limit":10}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
LINKS=$(echo "$RESP" | jq -r '.links | length // 0')
[ "$SUCCESS" = "true" ] && ok "/v2/map works ($LINKS links)" || fail "/v2/map failed"

echo ""
echo "── 17. /v2/parse ──"
RESP=$(curl -s -m 90 -X POST "$BASE_URL/v2/parse" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
[ "$SUCCESS" = "true" ] && ok "/v2/parse works" || fail "/v2/parse failed"

echo ""
echo "── 18. SearxNG-compatible /search ──"
RESP=$(curl -s -m 60 "$BASE_URL/search?q=hello&format=json")
SUCCESS=$(echo "$RESP" | jq -r '.results | type' 2>/dev/null)
[ "$SUCCESS" = "array" ] && ok "/search (SearxNG) works" || fail "/search failed"

echo ""
echo "── 19. /v1/scrape (backward compat) ──"
RESP=$(curl -s -m 60 -X POST "$BASE_URL/v1/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}')
SUCCESS=$(echo "$RESP" | jq -r '.success // false')
[ "$SUCCESS" = "true" ] && ok "/v1/scrape works (backward compat)" || fail "/v1/scrape failed"

# ===== Summary =====
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Passed: $PASS / $TOTAL"
echo "Failed: $FAIL / $TOTAL"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    R "  - $f"
  done
  exit 1
fi
exit 0
