/**
 * Test 5: run_ingestion tool — fetch raw data + synthesize into wiki in one step.
 * Verifies the "ingest my emails" flow works end-to-end.
 *
 * Run with: npx tsx tests/test_ingestion.ts
 */

import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIngestion, type AgentRunner } from "../src/pipelines/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testIngestion(): Promise<boolean> {
  const testDir = await mkdtemp(path.join(tmpdir(), "ow-test-ingest-"));
  const origCwd = process.cwd();

  try {
    process.chdir(testDir);

    // Track agent invocation
    let agentCalled = false;
    let agentMessage = "";
    const mockAgent: AgentRunner = async (cwd, userMessage) => {
      agentCalled = true;
      agentMessage = userMessage;

      // Simulate agent reading inbox and writing wiki
      const inboxDir = path.join(cwd, ".inbox");
      const files = await readdir(inboxDir);
      const jsonFile = files.find((f) => f.endsWith(".json"));
      if (!jsonFile) return { ran: false, reason: "No inbox files" };

      const data = JSON.parse(await readFile(path.join(inboxDir, jsonFile), "utf8"));
      const wikiDir = path.join(cwd, "openwiki");
      await mkdir(wikiDir, { recursive: true });
      await writeFile(
        path.join(wikiDir, "quickstart.md"),
        `# Knowledge Base\n\nSynthesized from ${data.count} ingested items.\n`,
      );
      return { ran: true };
    };

    // Write a web connector config
    const config = { urls: ["https://httpbin.org/json"] };
    const configPath = path.join(testDir, "web.config.json");
    await writeFile(configPath, JSON.stringify(config));

    // Run ingestion: fetch + synthesize in one step
    const result = await runIngestion("web", configPath, testDir, {
      agentRunner: mockAgent,
    });

    // Verify connector ran
    if (result.connector !== "web") throw new Error("Wrong connector name");
    if (result.inboxFiles.length === 0) throw new Error("No inbox files produced");
    console.log(`PASS: Connector fetched data → ${result.inboxFiles.length} new inbox file(s)`);

    // Verify agent ran (the synthesis step)
    if (!agentCalled) throw new Error("Agent synthesis step was NOT called");
    if (!agentMessage.includes("inbox")) throw new Error("Agent got wrong message");
    if (!result.agentResult.ran) throw new Error("Agent result shows failure");
    console.log(`PASS: Agent synthesis step ran after fetch`);
    console.log(`  - Agent message: "${agentMessage}"`);
    console.log(`  - Agent result: ${JSON.stringify(result.agentResult)}`);

    // Verify wiki was written
    const wiki = await readFile(path.join(testDir, "openwiki", "quickstart.md"), "utf8");
    if (!wiki.includes("Knowledge Base")) throw new Error("Wiki not written from inbox data");
    console.log(`PASS: Wiki synthesized from ingested data`);

    console.log("\nALL PASS: run_ingestion — fetch + synthesize in one step");
    return true;
  } catch (error) {
    console.error("FAIL:", error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    process.chdir(origCwd);
    await rm(testDir, { recursive: true, force: true });
  }
}

const success = await testIngestion();
process.exit(success ? 0 : 1);
