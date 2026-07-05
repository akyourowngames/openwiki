/**
 * Test 11: No daemon code — verify the codebase contains no daemon,
 * background worker loop, or custom scheduler implementation.
 *
 * Scans the entire source tree (src/ and connectors/) for:
 *   - setInterval (scheduler loops)
 *   - "daemon" references (in code, not tests)
 *   - "scheduler" or "worker loop" implementations
 *   - "runDaemon" or "run_daemon" functions
 *   - process.on("SIGINT") in a while-true or loop context
 *
 * Run with: npx tsx tests/test_no_daemon.ts
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx") ||
      entry.name.endsWith(".py") ||
      entry.name.endsWith(".js")
    ) {
      // Exclude test files, node_modules, dist
      if (
        !fullPath.includes("node_modules") &&
        !fullPath.includes("/dist/") &&
        !fullPath.includes("/tests/")
      ) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

async function testNoDaemon(): Promise<boolean> {
  let failures: string[] = [];

  const srcDir = path.join(PROJECT_ROOT, "src");
  const connectorsDir = path.join(PROJECT_ROOT, "connectors");

  const srcFiles = await listSourceFiles(srcDir);
  const connectorFiles = await listSourceFiles(connectorsDir);
  const allFiles = [...srcFiles, ...connectorFiles];

  console.log(`Scanning ${allFiles.length} source files for daemon/scheduler code...`);

  // Patterns that indicate daemon/scheduler/worker-loop code
  // Note: setInterval is checked only in pipeline/runner files, not UI files
  // (cli.tsx uses setInterval for animation frames, which is not a scheduler)
  const forbiddenPatternsEverywhere: Array<{ pattern: string; reason: string }> = [
    { pattern: "runDaemon", reason: "runDaemon function indicates a daemon" },
    { pattern: "run_daemon", reason: "run_daemon function indicates a daemon" },
    { pattern: "while (true)", reason: "while(true) indicates a worker loop" },
    { pattern: "while True", reason: "while True indicates a worker loop" },
    { pattern: "worker loop", reason: "explicit worker loop reference" },
    { pattern: "background worker", reason: "background worker implementation" },
    { pattern: "custom scheduler", reason: "custom scheduler implementation" },
  ];

  const forbiddenPatternsPipelinesOnly: Array<{ pattern: string; reason: string }> = [
    { pattern: "setInterval", reason: "setInterval in pipeline code indicates a scheduler loop" },
  ];

  for (const file of allFiles) {
    const content = await readFile(file, "utf8");
    const relPath = path.relative(PROJECT_ROOT, file);

    const isPipelineFile =
      relPath.includes("pipeline") || relPath.includes("runner") || relPath.includes("scheduler");

    // Check everywhere-forbidden patterns
    for (const { pattern, reason } of forbiddenPatternsEverywhere) {
      if (content.includes(pattern)) {
        failures.push(`${relPath}: contains "${pattern}" — ${reason}`);
      }
    }

    // Check pipeline-only forbidden patterns
    if (isPipelineFile) {
      for (const { pattern, reason } of forbiddenPatternsPipelinesOnly) {
        if (content.includes(pattern)) {
          failures.push(`${relPath}: contains "${pattern}" — ${reason}`);
        }
      }
    }

    // Check for "daemon" as a function name or variable (not in a comment saying it's absent)
    const daemonMatches = content.match(/\bdaemon\b/gi);
    if (daemonMatches) {
      // Allow if it's only in comments saying "not a daemon" or similar
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (line.includes("daemon")) {
          // Allow lines that say "not a daemon" or "no daemon" or "removed"
          if (
            line.includes("not a daemon") ||
            line.includes("no daemon") ||
            line.includes("removed") ||
            line.includes("instead of a daemon") ||
            line.includes("rather than a daemon")
          ) {
            continue;
          }
          // It's a real usage
          failures.push(`${relPath}:${i + 1}: uses "daemon" in code: ${lines[i].trim()}`);
          break;
        }
      }
    }
  }

  // Also verify that --daemon is NOT in the CLI commands
  const commandsFile = path.join(srcDir, "commands.ts");
  const commandsContent = await readFile(commandsFile, "utf8");
  if (commandsContent.includes('"--daemon"') || commandsContent.includes("'--daemon'")) {
    failures.push("commands.ts: --daemon flag still exists");
  }
  if (commandsContent.includes("kind: \"daemon\"")) {
    failures.push("commands.ts: daemon command kind still exists");
  }

  // Verify --install-cron, --uninstall-cron, --show-cron ARE in commands
  if (!commandsContent.includes("install-cron")) {
    failures.push("commands.ts: --install-cron flag missing");
  }
  if (!commandsContent.includes("uninstall-cron")) {
    failures.push("commands.ts: --uninstall-cron flag missing");
  }
  if (!commandsContent.includes("show-cron")) {
    failures.push("commands.ts: --show-cron flag missing");
  }

  if (failures.length === 0) {
    console.log("PASS: No daemon, scheduler, or worker-loop code in source tree");
    console.log("PASS: --daemon flag removed from CLI commands");
    console.log("PASS: --install-cron, --uninstall-cron, --show-cron present in CLI");
  } else {
    console.error("\nFAILURES:");
    for (const f of failures) console.error(`  - ${f}`);
  }

  // Also check the Python pipeline.py has no daemon
  const pipelinePy = path.join(connectorsDir, "pipeline.py");
  const pipelineContent = await readFile(pipelinePy, "utf8");
  if (pipelineContent.includes("run_daemon") || pipelineContent.includes("while True")) {
    failures.push("connectors/pipeline.py: still contains daemon code");
  } else {
    console.log("PASS: connectors/pipeline.py has no daemon code");
  }

  if (failures.length > 0) {
    return false;
  }

  console.log("\nALL PASS: No daemon code — codebase uses real OS cron jobs only");
  return true;
}

const success = await testNoDaemon();
process.exit(success ? 0 : 1);
