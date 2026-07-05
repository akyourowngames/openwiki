/**
 * Test 8: Chat ingestion feedback — agent reports start, progress, completion, errors.
 *
 * Verifies that run_ingestion returns structured messages array with:
 *   - Start notification
 *   - Fetch progress
 *   - Synthesis progress
 *   - Completion or error
 * And that errors produce proper error messages.
 *
 * Run with: npx tsx tests/test_ingestion_feedback.ts
 */

import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIngestion, type AgentRunner } from "../src/pipelines/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testIngestionFeedback(): Promise<boolean> {
  let failures: string[] = [];

  // === Test A: Successful ingestion reports start → fetching → synthesizing → completed ===
  {
    const testDir = await mkdtemp(path.join(tmpdir(), "ow-test-fb-ok-"));
    const origCwd = process.cwd();
    try {
      process.chdir(testDir);

      const mockAgent: AgentRunner = async () => {
        // Simulate agent writing wiki
        const wikiDir = path.join(process.cwd(), "openwiki");
        await mkdir(wikiDir, { recursive: true });
        await writeFile(path.join(wikiDir, "quickstart.md"), "# KB\n");
        return { ran: true };
      };

      const config = { urls: ["https://httpbin.org/json"] };
      const configPath = path.join(testDir, "web.config.json");
      await writeFile(configPath, JSON.stringify(config));

      const result = await runIngestion("web", configPath, testDir, {
        agentRunner: mockAgent,
      });

      const msgs = result.messages;

      // Check for start message
      if (!msgs.some((m) => m.toLowerCase().includes("started"))) {
        failures.push("No 'started' message in successful ingestion");
      }

      // Check for fetching progress
      if (!msgs.some((m) => m.toLowerCase().includes("fetching"))) {
        failures.push("No 'fetching' progress message");
      }

      // Check for synthesizing progress
      if (!msgs.some((m) => m.toLowerCase().includes("synthesizing"))) {
        failures.push("No 'synthesizing' progress message");
      }

      // Check for completion
      if (!msgs.some((m) => m.toLowerCase().includes("completed"))) {
        failures.push("No 'completed' message");
      }

      // Check status field
      if (result.status !== "completed") {
        failures.push(`Expected status='completed', got '${result.status}'`);
      }

      // Check no error field on success
      if (result.error) {
        failures.push(`Unexpected error on success: ${result.error}`);
      }

      if (failures.length === 0) {
        console.log("PASS: Successful ingestion reports start → fetching → synthesizing → completed");
        console.log(`  Messages: ${msgs.length} status updates`);
        for (const m of msgs) console.log(`    - ${m}`);
      }
    } finally {
      process.chdir(origCwd);
      await rm(testDir, { recursive: true, force: true });
    }
  }

  // === Test B: Connector error produces error message ===
  {
    const testDir = await mkdtemp(path.join(tmpdir(), "ow-test-fb-err-"));
    const origCwd = process.cwd();
    try {
      process.chdir(testDir);

      // Use a non-existent config file to trigger connector error
      const result = await runIngestion("web", "/nonexistent/path.json", testDir, {
        agentRunner: async () => ({ ran: true }),
      });

      const msgs = result.messages;

      // Should have a start message
      if (!msgs.some((m) => m.toLowerCase().includes("started"))) {
        failures.push("No 'started' message on error path");
      }

      // Should have an error message
      if (!msgs.some((m) => m.toLowerCase().includes("error"))) {
        failures.push("No 'error' message on connector failure");
      }

      // Status should be error
      if (result.status !== "error") {
        failures.push(`Expected status='error', got '${result.status}'`);
      }

      // Should have error field
      if (!result.error) {
        failures.push("No error field on error result");
      }

      if (failures.length === 0) {
        console.log("PASS: Connector error reports start → error with message");
        console.log(`  Status: ${result.status}`);
        console.log(`  Error: ${result.error}`);
      }
    } finally {
      process.chdir(origCwd);
      await rm(testDir, { recursive: true, force: true });
    }
  }

  // === Test C: Agent synthesis error produces error message ===
  {
    const testDir = await mkdtemp(path.join(tmpdir(), "ow-test-fb-agent-err-"));
    const origCwd = process.cwd();
    try {
      process.chdir(testDir);

      const config = { urls: ["https://httpbin.org/json"] };
      const configPath = path.join(testDir, "web.config.json");
      await writeFile(configPath, JSON.stringify(config));

      // Agent that always fails
      const failingAgent: AgentRunner = async () => {
        return { ran: false, reason: "LLM API rate limit exceeded" };
      };

      const result = await runIngestion("web", configPath, testDir, {
        agentRunner: failingAgent,
      });

      const msgs = result.messages;

      // Should have start + fetching + synthesizing messages
      if (!msgs.some((m) => m.toLowerCase().includes("started"))) {
        failures.push("No 'started' message on agent error path");
      }
      if (!msgs.some((m) => m.toLowerCase().includes("fetching"))) {
        failures.push("No 'fetching' message on agent error path");
      }
      if (!msgs.some((m) => m.toLowerCase().includes("synthesizing"))) {
        failures.push("No 'synthesizing' message on agent error path");
      }

      // Should have error message with the reason
      if (!msgs.some((m) => m.toLowerCase().includes("error"))) {
        failures.push("No 'error' message on agent failure");
      }
      if (!msgs.some((m) => m.includes("rate limit"))) {
        failures.push("Error message doesn't include the failure reason");
      }

      // Status should be error
      if (result.status !== "error") {
        failures.push(`Expected status='error' for agent failure, got '${result.status}'`);
      }

      if (failures.length === 0) {
        console.log("PASS: Agent synthesis error reports start → fetching → synthesizing → error");
        console.log(`  Status: ${result.status}`);
      }
    } finally {
      process.chdir(origCwd);
      await rm(testDir, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error(`  - ${f}`);
    return false;
  }

  console.log("\nALL PASS: Chat ingestion feedback — start, progress, completion, and errors");
  return true;
}

const success = await testIngestionFeedback();
process.exit(success ? 0 : 1);
