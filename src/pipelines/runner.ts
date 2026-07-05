import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getPipeline, listPipelines } from "./manager.js";
import { runOpenWikiAgent } from "../agent/index.js";

const execFileAsync = promisify(execFile);

/**
 * The project root where the `connectors/` package lives.
 * In production this is the npm package install dir; in dev it's the repo root.
 */
const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

/** Tag prepended to crontab entries so we can find/remove them later. */
const CRON_TAG = "# openwiki-pipeline";

export type AgentRunResult = {
  ran: boolean;
  reason?: string;
};

export type AgentRunner = (
  cwd: string,
  userMessage: string,
) => Promise<AgentRunResult>;

export type PipelineRunOptions = {
  /** Override the agent runner (for testing without real LLM credentials). */
  agentRunner?: AgentRunner;
};

export type PipelineRunResult = {
  pipeline: string;
  connectorResults: Array<{
    connector: string;
    stdout: string;
    stateFile: string;
  }>;
  agentResult: AgentRunResult | null;
};

export type IngestionResult = {
  connector: string;
  status: "completed" | "error";
  connectorStdout: string;
  inboxFiles: string[];
  agentResult: AgentRunResult;
  messages: string[];
  error?: string;
};

/**
 * Default agent runner — calls the real OpenWiki update agent.
 */
const defaultAgentRunner: AgentRunner = async (cwd, userMessage) => {
  try {
    await runOpenWikiAgent("update", cwd, { userMessage });
    return { ran: true };
  } catch (error) {
    return {
      ran: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Run a single connector by shelling out to the Python connector runner.
 * Returns stdout from the Python process.
 */
async function runConnector(
  connectorName: string,
  configPath: string,
  inboxDir: string,
  statePath: string,
): Promise<{ stdout: string; stateFile: string }> {
  await mkdir(inboxDir, { recursive: true });
  const { stdout } = await execFileAsync(
    "python3",
    [
      "-m",
      "connectors.run",
      connectorName,
      "--config",
      configPath,
      "--inbox",
      inboxDir,
      "--state",
      statePath,
    ],
    {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
      env: { ...process.env, PYTHONPATH: PROJECT_ROOT },
    },
  );
  return { stdout, stateFile: statePath };
}

/**
 * Run an ingestion: fetch raw data via a connector, then run the update agent
 * to synthesize it into the wiki. This is the "ingest my emails" flow —
 * one call that does both fetch + LLM extraction.
 *
 * Returns structured status messages that the chat UI can relay to the user
 * (start → fetching → synthesizing → completed/error).
 */
export async function runIngestion(
  connectorName: string,
  configPath: string,
  cwd: string,
  options: PipelineRunOptions = {},
): Promise<IngestionResult> {
  const messages: string[] = [];
  messages.push(`Ingestion started: fetching data from '${connectorName}' using config ${configPath}`);

  const inboxDir = path.join(cwd, ".inbox");
  await mkdir(inboxDir, { recursive: true });

  // Read inbox files before connector runs so we can diff what's new
  const beforeFiles = await listInboxFiles(inboxDir);

  const statePath = configPath.replace(/\.json$/, ".state.json");

  // Step 1: Fetch raw data
  let connectorStdout = "";
  try {
    messages.push(`Fetching: running connector '${connectorName}'...`);
    const connResult = await runConnector(
      connectorName,
      configPath,
      inboxDir,
      statePath,
    );
    connectorStdout = connResult.stdout;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    messages.push(`Error: connector '${connectorName}' failed: ${errMsg}`);
    return {
      connector: connectorName,
      status: "error",
      connectorStdout,
      inboxFiles: [],
      agentResult: { ran: false, reason: errMsg },
      messages,
      error: errMsg,
    };
  }

  const afterFiles = await listInboxFiles(inboxDir);
  const newFiles = afterFiles.filter((f) => !beforeFiles.includes(f));
  messages.push(`Fetched: ${newFiles.length} new item(s) written to .inbox/`);

  // Step 2: Run agent synthesis
  messages.push(`Synthesizing: running update agent on inbox data...`);
  const runner = options.agentRunner ?? defaultAgentRunner;
  let agentResult: AgentRunResult;
  try {
    agentResult = await runner(
      cwd,
      "Update the wiki from new inbox data in .inbox/.",
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    messages.push(`Error: agent synthesis failed: ${errMsg}`);
    return {
      connector: connectorName,
      status: "error",
      connectorStdout,
      inboxFiles: newFiles,
      agentResult: { ran: false, reason: errMsg },
      messages,
      error: errMsg,
    };
  }

  if (agentResult.ran) {
    messages.push(`Completed: ingestion from '${connectorName}' finished successfully. ${newFiles.length} item(s) ingested and wiki updated.`);
  } else {
    messages.push(`Error: agent synthesis reported failure: ${agentResult.reason ?? "unknown error"}`);
  }

  return {
    connector: connectorName,
    status: agentResult.ran ? "completed" : "error",
    connectorStdout,
    inboxFiles: newFiles,
    agentResult,
    messages,
  };
}

async function listInboxFiles(inboxDir: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(inboxDir);
  } catch {
    return [];
  }
}

/**
 * Execute a pipeline: run all connectors, then optionally run the update agent.
 */
export async function runPipeline(
  name: string,
  cwd: string,
  options: PipelineRunOptions = {},
): Promise<PipelineRunResult> {
  const pipeline = await getPipeline(cwd, name);
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${name}`);
  }

  const inboxDir = path.join(cwd, ".inbox");
  await mkdir(inboxDir, { recursive: true });

  const connectorResults: PipelineRunResult["connectorResults"] = [];

  for (const conn of pipeline.connectors) {
    const statePath = conn.config.replace(/\.json$/, ".state.json");
    const result = await runConnector(
      conn.name,
      conn.config,
      inboxDir,
      statePath,
    );
    connectorResults.push({
      connector: conn.name,
      stdout: result.stdout,
      stateFile: result.stateFile,
    });
  }

  let agentResult: PipelineRunResult["agentResult"] = null;

  if (pipeline.runAgent) {
    const runner = options.agentRunner ?? defaultAgentRunner;
    agentResult = await runner(
      cwd,
      "Update the wiki from new inbox data in .inbox/.",
    );
  }

  return { pipeline: name, connectorResults, agentResult };
}

// ---------------------------------------------------------------------------
// Cron job management — real crontab, not a daemon
// ---------------------------------------------------------------------------

/**
 * Build the crontab entry lines for all pipelines in pipelines.json.
 * Each entry uses the real cron schedule and tags with CRON_TAG so they
 * can be found/removed later. This is pure — it does NOT touch the OS
 * crontab, so it can be unit-tested safely.
 */
export function buildCronEntries(
  cwd: string,
  pipelines: Array<{ name: string; schedule: string }>,
  openwikiBin: string,
): string[] {
  return pipelines.map((p) => {
    const cmd = `cd ${cwd} && ${openwikiBin} --run-pipeline ${p.name} >> ${path.join(cwd, "openwiki-cron.log")} 2>&1`;
    return `${p.schedule} ${cmd} ${CRON_TAG}:${p.name}`;
  });
}

/**
 * Install all pipelines from pipelines.json as real cron jobs.
 * Uses `crontab -l` to read existing entries, filters out old OpenWiki
 * entries, and writes the new crontab via `crontab -`.
 */
export async function installCronJobs(cwd: string): Promise<{
  installed: number;
  entries: string[];
}> {
  const pipelines = await listPipelines(cwd);
  const openwikiBin = await findOpenwikiBin();

  // Read existing crontab, removing old openwiki entries
  const existing = await readCrontab();
  const filtered = existing.filter((line) => !line.includes(CRON_TAG));

  // Build new entries
  const entries = buildCronEntries(
    cwd,
    pipelines.map((p) => ({ name: p.name, schedule: p.schedule })),
    openwikiBin,
  );

  const newCrontab = [...filtered, ...entries].join("\n") + "\n";
  await writeCrontab(newCrontab);

  return { installed: entries.length, entries };
}

/**
 * Remove all OpenWiki cron jobs from the crontab.
 */
export async function uninstallCronJobs(): Promise<{ removed: number }> {
  const existing = await readCrontab();
  const filtered = existing.filter((line) => !line.includes(CRON_TAG));
  const removed = existing.length - filtered.length;

  if (filtered.length > 0) {
    await writeCrontab(filtered.join("\n") + "\n");
  } else {
    await writeCrontab("");
  }

  return { removed };
}

/**
 * Show currently installed OpenWiki cron jobs.
 */
export async function showCronJobs(): Promise<string[]> {
  const existing = await readCrontab();
  return existing.filter((line) => line.includes(CRON_TAG));
}

async function writeCrontab(content: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const proc = spawn("crontab", ["-"]);
    proc.stdin?.write(content);
    proc.stdin?.end();
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`crontab exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function readCrontab(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"], {
      timeout: 5000,
    });
    return stdout
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch {
    // No crontab for this user, or crontab command failed — return empty
    return [];
  }
}

async function findOpenwikiBin(): Promise<string> {
  // Try to find the openwiki binary
  try {
    const { stdout } = await execFileAsync("which", ["openwiki"], {
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    // Fall back to npx
    return "npx openwiki";
  }
}
