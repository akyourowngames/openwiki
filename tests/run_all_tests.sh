#!/usr/bin/env bash
# Run all OpenWiki tests.
set -e

cd "$(dirname "$0")/.."

echo "=========================================="
echo "OpenWiki Test Suite"
echo "=========================================="
echo ""

echo "--- Test 1: Agent-generated connector with mock config ---"
python3 tests/test_agent_connector.py
echo ""

echo "--- Test 2a: All 3 prebuilt connectors run with sample config ---"
python3 tests/test_all_connectors.py
echo ""

echo "--- Test 2b: Prebuilt connector + update agent pipeline E2E ---"
npx tsx tests/test_pipeline_agent_e2e.ts
echo ""

echo "--- Test 3: Chat UI handles pipeline setup + KB question ---"
npx tsx tests/test_chat_ui.ts
echo ""

echo "--- Test 4: Scope control — out-of-scope requests refused ---"
npx tsx tests/test_scope_control.ts
echo ""

echo "--- Test 5: run_ingestion — fetch + synthesize in one step ---"
npx tsx tests/test_ingestion.ts
echo ""

echo "--- Test 6: Local directory connector runs as a standard pipeline ---"
python3 tests/test_local_connector.py
echo ""

echo "--- Test 7: Setup does not scan local repo ---"
npx tsx tests/test_no_repo_scan.ts
echo ""

echo "--- Test 8: Chat ingestion feedback (start/progress/completion/errors) ---"
npx tsx tests/test_ingestion_feedback.ts
echo ""

echo "--- Test 9: Scope control — only mapped connectors can run ---"
npx tsx tests/test_scope_mapped.ts
echo ""

echo "--- Test 10: Real cron jobs — install, verify, remove from OS crontab ---"
npx tsx tests/test_cron_jobs.ts
echo ""

echo "--- Test 11: No daemon code in source tree ---"
npx tsx tests/test_no_daemon.ts
echo ""

echo "=========================================="
echo "All tests passed!"
echo "=========================================="
