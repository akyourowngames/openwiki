/**
 * Test 2b: Prebuilt connector + update agent pipeline runs end-to-end.
 *
 * This test demonstrates the FULL pipeline flow:
 *   1. Create a pipeline with a prebuilt connector (web) + runAgent=true
 *   2. Run the pipeline
 *   3. Verify the connector fetched data to .inbox/
 *   4. Verify the update agent step was invoked on the result
 *
 * Uses an injectable agentRunner so we can verify the agent step fires
 * without requiring real LLM API keys.
 *
 * Run with: npx tsx tests/test_pipeline_agent_e2e.ts
 */

import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addPipeline } from "../src/pipelines/manager.js";
import { runPipeline, type AgentRunner } from "../src/pipelines/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testPipelineAgentE2E(): Promise<boolean> {
  const testDir = await mkdtemp(path.join(tmpdir(), "ow-test-e2e-agent-"));
  const origCwd = process.cwd();

  try {
    process.chdir(testDir);

    // Track whether the agent step was called
    let agentCalled = false;
    let agentReceivedMessage = "";
    let agentReceivedCwd = "";

    // Injectable agent runner — records that it was called, simulates
    // the agent reading inbox data and updating the wiki
    const mockAgentRunner: AgentRunner = async (cwd, userMessage) => {
      agentCalled = true;
      agentReceivedMessage = userMessage;
      agentReceivedCwd = cwd;

      // Simulate the agent reading inbox data and writing a wiki page
      const inboxDir = path.join(cwd, ".inbox");
      const files = await readdir(inboxDir);
      const inboxFile = files.find((f) => f.endsWith(".json"));
      if (!inboxFile) {
        return { ran: false, reason: "No inbox files found" };
      }

      const inboxData = await readFile(path.join(inboxDir, inboxFile), "utf8");
      const data = JSON.parse(inboxData);

      // Simulate agent writing wiki content from the inbox data
      const wikiDir = path.join(cwd, "openwiki");
      await mkdir(wikiDir, { recursive: true });
      await writeFile(
        path.join(wikiDir, "quickstart.md"),
        `# Knowledge Base\n\nUpdated from ${data.count || 0} ingested items.\n\n` +
          `Source: ${data.items?.[0]?.url || data.items?.[0]?.feed_url || "unknown"}\n`,
      );

      return { ran: true };
    };

    // === Step 1: Write a web connector config ===
    const config = { urls: ["https://httpbin.org/json"] };
    const configPath = path.join(testDir, "web.config.json");
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // === Step 2: Create a pipeline with runAgent=true ===
    const pipeline = await addPipeline(testDir, {
      name: "daily-web-with-agent",
      schedule: "0 9 * * *",
      connectors: [{ name: "web", config: configPath }],
      runAgent: true,
    });
    console.log(`PASS: Created pipeline '${pipeline.name}' with runAgent=${pipeline.runAgent}`);

    // === Step 3: Run the pipeline ===
    const result = await runPipeline("daily-web-with-agent", testDir, {
      agentRunner: mockAgentRunner,
    });

    // === Step 4: Verify connector ran ===
    if (result.connectorResults.length !== 1) {
      throw new Error(`Expected 1 connector result, got ${result.connectorResults.length}`);
    }
    if (result.connectorResults[0].connector !== "web") {
      throw new Error(`Expected 'web' connector, got '${result.connectorResults[0].connector}'`);
    }
    console.log("PASS: Connector 'web' ran and produced data");

    // Verify inbox data exists
    const inboxDir = path.join(testDir, ".inbox");
    const inboxFiles = await readdir(inboxDir);
    const webFiles = inboxFiles.filter((f) => f.startsWith("web-"));
    if (webFiles.length === 0) {
      throw new Error("No web inbox files found");
    }
    const inboxData = JSON.parse(
      await readFile(path.join(inboxDir, webFiles[0]), "utf8"),
    );
    if (inboxData.count !== 1) {
      throw new Error(`Expected count=1, got ${inboxData.count}`);
    }
    console.log(`PASS: Connector fetched ${inboxData.count} items to .inbox/${webFiles[0]}`);

    // === Step 5: Verify the update agent step ran ===
    if (!agentCalled) {
      throw new Error("Update agent was NOT called — pipeline did not trigger agent step");
    }
    if (!agentReceivedMessage.includes("inbox")) {
      throw new Error(`Agent received unexpected message: "${agentReceivedMessage}"`);
    }
    if (agentReceivedCwd !== testDir) {
      throw new Error(`Agent received wrong cwd: "${agentReceivedCwd}"`);
    }
    if (!result.agentResult || result.agentResult.ran !== true) {
      throw new Error(`Agent result shows it didn't run: ${JSON.stringify(result.agentResult)}`);
    }
    console.log("PASS: Update agent was invoked on the fetched data");
    console.log(`  - Agent message: "${agentReceivedMessage}"`);
    console.log(`  - Agent result: ${JSON.stringify(result.agentResult)}`);

    // === Step 6: Verify the agent actually processed the inbox data ===
    const wikiContent = await readFile(
      path.join(testDir, "openwiki", "quickstart.md"),
      "utf8",
    );
    if (!wikiContent.includes("Knowledge Base")) {
      throw new Error("Agent did not write wiki content from inbox data");
    }
    console.log("PASS: Agent processed inbox data and updated the wiki");

    // === Step 7: Verify pipeline persistence across restart ===
    const { loadPipelines } = await import("../src/pipelines/manager.js");
    const reloaded = await loadPipelines(testDir);
    if (reloaded.pipelines.length !== 1 || reloaded.pipelines[0].name !== "daily-web-with-agent") {
      throw new Error("Pipeline not persisted across restart");
    }
    console.log("PASS: Pipeline persisted to pipelines.json (survives restart)");

    console.log("\nALL PASS: Prebuilt connector + update agent pipeline runs end-to-end");
    return true;
  } catch (error) {
    console.error("FAIL:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return false;
  } finally {
    process.chdir(origCwd);
    await rm(testDir, { recursive: true, force: true });
  }
}

const success = await testPipelineAgentE2E();
process.exit(success ? 0 : 1);
