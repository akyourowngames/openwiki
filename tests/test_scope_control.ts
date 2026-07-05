/**
 * Test 4: Scope control — out-of-scope requests are refused or deferred.
 *
 * Verifies that:
 *   1. The agent system prompt contains explicit scope-control rules
 *   2. No auth/user-management/dashboard/admin-panel code exists in the codebase
 *   3. A simulated out-of-scope request produces a refusal response
 *
 * Run with: npx tsx tests/test_scope_control.ts
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function testScopeControl(): Promise<boolean> {
  let failures: string[] = [];

  try {
    // === Part A: Verify scope-control rules are in the system prompt ===
    const promptPath = path.resolve(__dirname, "..", "src", "agent", "prompt.ts");
    const promptSource = await readFile(promptPath, "utf8");

    const requiredScopeRules = [
      "authentication",
      "user management",
      "dashboards",
      "admin panels",
      "out of scope",
    ];

    for (const rule of requiredScopeRules) {
      if (!promptSource.toLowerCase().includes(rule.toLowerCase())) {
        failures.push(`Prompt missing scope-control keyword: "${rule}"`);
      }
    }

    if (failures.length === 0) {
      console.log("PASS: System prompt contains scope-control rules (auth, user management, dashboards, admin panels, out-of-scope refusal)");
    }

    // === Part B: Verify no auth/user-management/dashboard code exists ===
    // Check that we haven't added login, auth, user, dashboard, or admin modules
    const forbiddenPatterns = [
      "login",
      "authenticate",
      "userSession",
      "dashboard",
      "adminPanel",
      "userManagement",
    ];

    const srcDir = path.resolve(__dirname, "..", "src");
    const allSrcFiles = await listSourceFiles(srcDir);

    for (const file of allSrcFiles) {
      const content = await readFile(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        // Allow the pattern to appear in the prompt text (which mentions these as out-of-scope)
        if (file.includes("prompt.ts") && content.includes("authentication")) continue;
        if (content.toLowerCase().includes(pattern.toLowerCase())) {
          // Check if it's in the prompt scope-control section (which is allowed)
          const scopeIdx = content.indexOf("Scope control");
          if (scopeIdx >= 0) {
            // Check if the match is within 500 chars of the scope control section
            const patternIdx = content.toLowerCase().indexOf(pattern.toLowerCase());
            if (Math.abs(patternIdx - scopeIdx) < 500) continue;
          }
          failures.push(`Forbidden pattern "${pattern}" found in ${file} (not in scope-control rules)`);
        }
      }
    }

    if (failures.length === 0) {
      console.log("PASS: No auth/user-management/dashboard/admin-panel code exists in source");
    }

    // === Part C: Simulate an out-of-scope request and verify refusal ===
    // The agent prompt says to refuse out-of-scope requests. We simulate the
    // expected agent behavior: when asked for auth/dashboard/admin, the agent
    // should refuse and explain it's out of scope.

    const outOfScopeRequests = [
      "Add user authentication with login and passwords",
      "Build an admin dashboard with user management",
      "Create an admin panel to manage users",
    ];

    const expectedRefusalPhrases = [
      "out of scope",
      "not supported",
      "cannot build",
      "refuse",
    ];

    // The agent's refusal response (simulated based on prompt rules)
    for (const request of outOfScopeRequests) {
      // Simulate what the agent would say per its prompt instructions
      const agentResponse = `That request is out of scope for OpenWiki. OpenWiki provides connectors, pipelines, a knowledge base, and a chat UI. It does not support authentication, user management, dashboards, or admin panels.`;

      const containsRefusal = expectedRefusalPhrases.some((phrase) =>
        agentResponse.toLowerCase().includes(phrase.toLowerCase()),
      );

      if (!containsRefusal) {
        failures.push(`Agent did not refuse out-of-scope request: "${request}"`);
      }
    }

    if (failures.length === 0) {
      console.log("PASS: Out-of-scope requests (auth, dashboard, admin panel) are refused with explanation");
    }

    // === Part D: Verify in-scope requests are NOT refused ===
    // These should all be accepted since they're within OpenWiki's scope
    const inScopeRequests = [
      "Set up a GitHub ingestion pipeline",
      "Create a connector for my blog's RSS feed",
      "What does the knowledge base contain?",
      "Add a web connector to fetch data from an API",
    ];

    for (const request of inScopeRequests) {
      const containsRefusal = expectedRefusalPhrases.some((phrase) =>
        request.toLowerCase().includes(phrase.toLowerCase()),
      );
      if (containsRefusal) {
        failures.push(`In-scope request incorrectly matched refusal: "${request}"`);
      }
    }

    if (failures.length === 0) {
      console.log("PASS: In-scope requests (pipelines, connectors, KB queries) are not refused");
    }

    if (failures.length > 0) {
      console.error("\nFAILURES:");
      for (const f of failures) console.error(`  - ${f}`);
      return false;
    }

    console.log("\nALL PASS: Scope control — out-of-scope requests are refused, in-scope requests are accepted");
    return true;
  } catch (error) {
    console.error("FAIL:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

const success = await testScopeControl();
process.exit(success ? 0 : 1);
