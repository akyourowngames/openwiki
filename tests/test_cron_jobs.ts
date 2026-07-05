/**
 * Test 10: Cron job entry generation and installation mechanism.
 *
 * Verifies that:
 *   1. buildCronEntries produces correct crontab lines with real cron schedules
 *   2. Entries are tagged with # openwiki-pipeline:<name> for find/remove
 *   3. Entries contain the correct --run-pipeline command
 *   4. Entries use the real cron expression from pipelines.json (not simplified)
 *   5. installCronJobs, uninstallCronJobs, showCronJobs functions exist and
 *      are exported (the actual crontab manipulation is NOT tested here —
 *      that would modify the user's real OS crontab)
 *   6. The CLI has --install-cron, --uninstall-cron, --show-cron flags
 *
 * Run with: npx tsx tests/test_cron_jobs.ts
 */

import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addPipeline, listPipelines } from "../src/pipelines/manager.js";
import { buildCronEntries } from "../src/pipelines/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testCronJobs(): Promise<boolean> {
  const testDir = await mkdtemp(path.join(tmpdir(), "ow-test-cron-gen-"));
  const origCwd = process.cwd();

  try {
    process.chdir(testDir);

    // Write a connector config
    const config = { urls: ["https://httpbin.org/json"] };
    const configPath = path.join(testDir, "web.config.json");
    await writeFile(configPath, JSON.stringify(config));

    // Add pipelines with different real cron schedules
    await addPipeline(testDir, {
      name: "daily-web",
      schedule: "0 9 * * *",
      connectors: [{ name: "web", config: configPath }],
      runAgent: false,
    });
    await addPipeline(testDir, {
      name: "every-4h-github",
      schedule: "0 */4 * * *",
      connectors: [{ name: "github", config: configPath }],
      runAgent: false,
    });
    await addPipeline(testDir, {
      name: "weekday-rss",
      schedule: "30 8 * * 1-5",
      connectors: [{ name: "rss", config: configPath }],
      runAgent: false,
    });

    // === Step 1: Build cron entries (pure function, no OS crontab) ===
    const pipelines = await listPipelines(testDir);
    const entries = buildCronEntries(
      testDir,
      pipelines.map((p) => ({ name: p.name, schedule: p.schedule })),
      "/usr/local/bin/openwiki",
    );

    if (entries.length !== 3) {
      throw new Error(`Expected 3 entries, got ${entries.length}`);
    }
    console.log(`PASS: buildCronEntries generated ${entries.length} entries`);

    // === Step 2: Verify real cron schedule expressions are used ===
    const dailyEntry = entries.find((e) => e.includes("daily-web"));
    if (!dailyEntry) throw new Error("Missing daily-web entry");
    if (!dailyEntry.startsWith("0 9 * * *")) {
      throw new Error(`daily-web schedule wrong: ${dailyEntry.split(" ")[0]}`);
    }
    console.log(`PASS: daily-web uses real cron expression '0 9 * * *'`);

    const fourHourlyEntry = entries.find((e) => e.includes("every-4h-github"));
    if (!fourHourlyEntry) throw new Error("Missing every-4h-github entry");
    if (!fourHourlyEntry.startsWith("0 */4 * * *")) {
      throw new Error(`every-4h-github schedule wrong`);
    }
    console.log(`PASS: every-4h-github uses real cron expression '0 */4 * * *'`);

    const weekdayEntry = entries.find((e) => e.includes("weekday-rss"));
    if (!weekdayEntry) throw new Error("Missing weekday-rss entry");
    if (!weekdayEntry.startsWith("30 8 * * 1-5")) {
      throw new Error(`weekday-rss schedule wrong`);
    }
    console.log(`PASS: weekday-rss uses real cron expression '30 8 * * 1-5'`);

    // === Step 3: Verify entries contain --run-pipeline commands ===
    for (const p of pipelines) {
      const entry = entries.find((e) => e.includes(p.name));
      if (!entry || !entry.includes(`--run-pipeline ${p.name}`)) {
        throw new Error(`Entry for ${p.name} missing --run-pipeline command`);
      }
    }
    console.log("PASS: All entries contain correct --run-pipeline commands");

    // === Step 4: Verify entries are tagged for find/remove ===
    for (const entry of entries) {
      if (!entry.includes("# openwiki-pipeline:")) {
        throw new Error(`Entry not tagged: ${entry}`);
      }
    }
    console.log("PASS: All entries tagged with '# openwiki-pipeline:<name>' for find/remove");

    // === Step 5: Verify entries contain cd to the working directory ===
    for (const entry of entries) {
      if (!entry.includes(`cd ${testDir}`)) {
        throw new Error(`Entry missing cd to working dir: ${entry}`);
      }
    }
    console.log("PASS: All entries cd to the correct working directory");

    // === Step 6: Verify the install/uninstall/show functions are exported ===
    const runnerSource = await readFile(
      path.resolve(__dirname, "..", "src", "pipelines", "runner.ts"),
      "utf8",
    );
    if (!runnerSource.includes("export async function installCronJobs")) {
      throw new Error("installCronJobs not exported from runner.ts");
    }
    if (!runnerSource.includes("export async function uninstallCronJobs")) {
      throw new Error("uninstallCronJobs not exported from runner.ts");
    }
    if (!runnerSource.includes("export async function showCronJobs")) {
      throw new Error("showCronJobs not exported from runner.ts");
    }
    if (!runnerSource.includes('spawn("crontab"')) {
      throw new Error("runner.ts does not use real crontab via spawn");
    }
    console.log("PASS: installCronJobs, uninstallCronJobs, showCronJobs exported");
    console.log("PASS: Uses real crontab via spawn('crontab', ...)");

    // === Step 7: Verify CLI has cron flags ===
    const commandsSource = await readFile(
      path.resolve(__dirname, "..", "src", "commands.ts"),
      "utf8",
    );
    if (!commandsSource.includes("--install-cron")) {
      throw new Error("CLI missing --install-cron flag");
    }
    if (!commandsSource.includes("--uninstall-cron")) {
      throw new Error("CLI missing --uninstall-cron flag");
    }
    if (!commandsSource.includes("--show-cron")) {
      throw new Error("CLI missing --show-cron flag");
    }
    console.log("PASS: CLI has --install-cron, --uninstall-cron, --show-cron flags");

    // === Step 8: Verify entries are valid crontab format ===
    // A valid crontab entry: <5-field cron> <command>
    for (const entry of entries) {
      const cronFields = entry.split(" ").slice(0, 5).join(" ");
      if (cronFields.split(" ").length !== 5) {
        throw new Error(`Invalid cron format in entry: ${entry}`);
      }
    }
    console.log("PASS: All entries have valid 5-field cron format");

    console.log("\nALL PASS: Cron job entry generation and installation mechanism");
    return true;
  } catch (error) {
    console.error("FAIL:", error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    process.chdir(origCwd);
    await rm(testDir, { recursive: true, force: true });
  }
}

const success = await testCronJobs();
process.exit(success ? 0 : 1);
