/**
 * Test 9: Scope control — agent can only run mapped/predefined connectors.
 *
 * Verifies that:
 *   1. Only registered connectors (from list_connectors or write_connector) can be run
 *   2. Arbitrary/unmapped script names are rejected
 *   3. The run_ingestion tool description enforces this constraint
 *   4. The system prompt contains the scope-control rule about mapped connectors
 *
 * Run with: npx tsx tests/test_scope_mapped.ts
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listPrebuiltConnectors, getPrebuiltConnector } from "../src/pipelines/manager.js";
import { runIngestion, type AgentRunner } from "../src/pipelines/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testScopeMapped(): Promise<boolean> {
  let failures: string[] = [];

  // === Part A: Only registered connector names are valid ===
  const connectors = listPrebuiltConnectors();
  const validNames = connectors.map((c) => c.name);
  console.log(`Registered connectors: ${validNames.join(", ")}`);

  // These should all be valid
  for (const name of validNames) {
    const conn = getPrebuiltConnector(name);
    if (!conn) {
      failures.push(`Registered connector '${name}' not found via getPrebuiltConnector`);
    }
  }

  // These should NOT be valid
  const invalidNames = ["arbitrary_script", "rm-rf", "/bin/sh", "eval", "exec"];
  for (const name of invalidNames) {
    const conn = getPrebuiltConnector(name);
    if (conn) {
      failures.push(`Invalid connector name '${name}' was found in registry!`);
    }
  }
  if (failures.length === 0) {
    console.log("PASS: Only registered connector names are valid; arbitrary names are rejected");
  }

  // === Part B: run_ingestion with an unregistered connector returns error ===
  {
    const mockAgent: AgentRunner = async () => ({ ran: true });
    // runIngestion catches the Python subprocess error and returns an error result
    const result = await runIngestion("evil_script", "/tmp/fake.json", process.cwd(), {
      agentRunner: mockAgent,
    });
    if (result.status !== "error") {
      failures.push(`Expected status='error' for unregistered connector, got '${result.status}'`);
    }
    if (!result.messages.some((m) => m.toLowerCase().includes("error"))) {
      failures.push("No error message for unregistered connector");
    }
    if (failures.length === 0) {
      console.log("PASS: Unregistered connector 'evil_script' returns error status with message");
      console.log(`  Status: ${result.status}`);
      console.log(`  Error: ${result.error}`);
    }
  }

  // === Part C: System prompt enforces mapped-connector-only rule ===
  const promptPath = path.resolve(__dirname, "..", "src", "agent", "prompt.ts");
  const promptSource = await readFile(promptPath, "utf8");
  const promptLower = promptSource.toLowerCase();
  if (!promptLower.includes("cannot run arbitrary")) {
    failures.push("System prompt does not enforce 'cannot run arbitrary scripts' rule");
  }
  if (!promptLower.includes("registered")) {
    failures.push("System prompt does not mention 'registered' connectors");
  }
  if (failures.length === 0) {
    console.log("PASS: System prompt enforces mapped-connector-only scope control");
  }

  // === Part D: Tool description enforces the constraint ===
  const toolsPath = path.resolve(__dirname, "..", "src", "agent", "tools.ts");
  const toolsSource = await readFile(toolsPath, "utf8");
  const toolsLower = toolsSource.toLowerCase();
  if (!toolsLower.includes("cannot run arbitrary")) {
    failures.push("run_ingestion tool description does not mention 'cannot run arbitrary scripts'");
  }
  if (failures.length === 0) {
    console.log("PASS: run_ingestion tool description enforces mapped-connector-only constraint");
  }

  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error(`  - ${f}`);
    return false;
  }

  console.log("\nALL PASS: Scope control — only mapped/predefined connectors can run");
  return true;
}

const success = await testScopeMapped();
process.exit(success ? 0 : 1);
