/**
 * Test 7: Setup does not scan local repo.
 *
 * Verifies that:
 *   1. createRunContext does NOT call git or read repo files
 *   2. The RunContext gitSummary says "not applicable"
 *   3. writeLastUpdateMetadata does NOT record gitHead
 *   4. The system prompt does NOT reference "inspect this codebase" or "repository"
 *
 * Run with: npx tsx tests/test_no_repo_scan.ts
 */

import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createRunContext, writeLastUpdateMetadata } from "../src/agent/utils.js";
import { createSystemPrompt } from "../src/agent/prompt.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testNoRepoScan(): Promise<boolean> {
  const testDir = await mkdtemp(path.join(tmpdir(), "ow-test-norepo-"));
  const origCwd = process.cwd();

  try {
    process.chdir(testDir);

    // Create a fake git repo so we can verify git is NOT called
    await execFileAsync("git", ["init"], { cwd: testDir });
    await writeFile(path.join(testDir, "README.md"), "# Test repo\n");
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: testDir });
    await writeFile(path.join(testDir, "new-file.txt"), "new content\n");

    // === Part A: createRunContext does NOT call git ===
    const context = await createRunContext("init", testDir);

    // The gitSummary should say "not applicable", not contain git output
    if (context.gitSummary.includes("git status") || context.gitSummary.includes("git log")) {
      throw new Error("createRunContext still runs git commands!");
    }
    if (!context.gitSummary.toLowerCase().includes("not applicable")) {
      throw new Error(`Expected gitSummary to say 'not applicable', got: "${context.gitSummary}"`);
    }
    console.log("PASS: createRunContext does not scan repo — gitSummary says 'not applicable'");
    console.log(`  gitSummary: "${context.gitSummary}"`);

    // Same for chat and update commands
    const chatContext = await createRunContext("chat", testDir);
    if (chatContext.gitSummary.includes("git status")) {
      throw new Error("createRunContext runs git for chat command!");
    }
    const updateContext = await createRunContext("update", testDir);
    if (updateContext.gitSummary.includes("git status")) {
      throw new Error("createRunContext runs git for update command!");
    }
    console.log("PASS: createRunContext does not scan repo for any command (chat, init, update)");

    // === Part B: writeLastUpdateMetadata does NOT record gitHead ===
    await mkdir(path.join(testDir, "openwiki"), { recursive: true });
    await writeLastUpdateMetadata("init", testDir, "test-model");

    const { readFile } = await import("node:fs/promises");
    const metadata = JSON.parse(
      await readFile(path.join(testDir, "openwiki", ".last-update.json"), "utf8"),
    );
    if (metadata.gitHead !== undefined) {
      throw new Error(`writeLastUpdateMetadata still records gitHead: ${metadata.gitHead}`);
    }
    console.log("PASS: writeLastUpdateMetadata does not record gitHead");
    console.log(`  Metadata: ${JSON.stringify(metadata)}`);

    // === Part C: System prompt does NOT reference codebase inspection ===
    const prompt = createSystemPrompt("init");
    if (prompt.toLowerCase().includes("inspect the current codebase")) {
      throw new Error("System prompt still says 'inspect the current codebase'!");
    }
    if (prompt.toLowerCase().includes("inspect the repository")) {
      throw new Error("System prompt still says 'inspect the repository'!");
    }
    if (prompt.toLowerCase().includes("document this repository")) {
      throw new Error("System prompt still says 'document this repository'!");
    }
    // Should reference personal knowledge wiki
    if (!prompt.toLowerCase().includes("personal knowledge wiki")) {
      throw new Error("System prompt does not mention 'personal knowledge wiki'!");
    }
    console.log("PASS: System prompt is about personal knowledge wiki, not codebase documentation");

    // === Part D: No git-related imports in utils.ts ===
    const utilsSource = await readFile(
      path.resolve(__dirname, "..", "src", "agent", "utils.ts"),
      "utf8",
    );
    if (utilsSource.includes("execFile") || utilsSource.includes("runGit") || utilsSource.includes("createGitSummary")) {
      throw new Error("utils.ts still contains git-related code!");
    }
    console.log("PASS: utils.ts contains no git-scanning code (no execFile, runGit, createGitSummary)");

    console.log("\nALL PASS: Setup does not scan local repo");
    return true;
  } catch (error) {
    console.error("FAIL:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) console.error(error.stack);
    return false;
  } finally {
    process.chdir(origCwd);
    await rm(testDir, { recursive: true, force: true });
  }
}

const success = await testNoRepoScan();
process.exit(success ? 0 : 1);
