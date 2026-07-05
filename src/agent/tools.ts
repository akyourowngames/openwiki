import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  listPrebuiltConnectors,
  getPrebuiltConnector,
  checkConnectorCredentials,
  addPipeline,
  listPipelines,
  getPipeline,
  removePipeline,
} from "../pipelines/manager.js";
import { runPipeline, runIngestion } from "../pipelines/runner.js";

/**
 * list_connectors — return all prebuilt connectors with metadata.
 */
export const listConnectorsTool = tool(
  async () => {
    const connectors = listPrebuiltConnectors();
    return JSON.stringify(
      connectors.map((c) => ({
        name: c.name,
        description: c.description,
        requiredEnvVars: c.requiredEnvVars,
        optionalEnvVars: c.optionalEnvVars,
      })),
      null,
      2,
    );
  },
  {
    name: "list_connectors",
    description:
      "List all available prebuilt data source connectors. Returns name, description, and required/optional environment variables for each.",
    schema: z.object({}),
  },
);

/**
 * check_credentials — check whether the env vars a connector needs are set.
 * Never returns secret values, only whether each var is set (true/false).
 */
export const checkCredentialsTool = tool(
  async ({ connectorName }: { connectorName: string }) => {
    const connector = getPrebuiltConnector(connectorName);
    if (!connector) {
      return JSON.stringify({ error: `Unknown connector: ${connectorName}` });
    }
    const status = checkConnectorCredentials(connector);
    return JSON.stringify(status, null, 2);
  },
  {
    name: "check_credentials",
    description:
      "Check whether the required and optional environment variables for a connector are set. Returns only set/not-set boolean status — never secret values.",
    schema: z.object({
      connectorName: z.string().describe("Name of the connector to check credentials for"),
    }),
  },
);

/**
 * create_pipeline — add a new ingestion pipeline to pipelines.json.
 */
export const createPipelineTool = tool(
  async ({
    name,
    connector,
    schedule,
    configPath,
    runAgent,
  }: {
    name: string;
    connector: string;
    schedule: string;
    configPath: string;
    runAgent: boolean;
  }) => {
    const cwd = process.cwd();
    const pipeline = await addPipeline(cwd, {
      name,
      schedule,
      connectors: [{ name: connector, config: configPath }],
      runAgent,
    });
    return JSON.stringify({ created: pipeline }, null, 2);
  },
  {
    name: "create_pipeline",
    description:
      "Create a new ingestion pipeline that runs a connector on a cron schedule. The pipeline is persisted to pipelines.json and survives restarts. After creating a pipeline, tell the user which env vars they need to set in their .env file.",
    schema: z.object({
      name: z.string().describe("Unique pipeline name, e.g. 'daily-github'"),
      connector: z.string().describe("Connector name from list_connectors, or 'custom'"),
      schedule: z.string().describe("Cron expression, e.g. '0 9 * * *' for daily at 9am, '0 */4 * * *' for every 4 hours"),
      configPath: z.string().describe("Path to the connector config JSON file"),
      runAgent: z.boolean().describe("Whether to run the update agent after ingestion"),
    }),
  },
);

/**
 * run_pipeline — manually trigger a pipeline to run now.
 */
export const runPipelineTool = tool(
  async ({ name }: { name: string }) => {
    const cwd = process.cwd();
    try {
      const result = await runPipeline(name, cwd);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  {
    name: "run_pipeline",
    description:
      "Manually trigger a pipeline to run immediately. Executes all connectors in the pipeline, then runs the update agent if enabled. Returns connector results and agent status.",
    schema: z.object({
      name: z.string().describe("Name of the pipeline to run"),
    }),
  },
);

/**
 * list_pipelines — list all configured pipelines.
 */
export const listPipelinesTool = tool(
  async () => {
    const cwd = process.cwd();
    const pipelines = await listPipelines(cwd);
    return JSON.stringify(pipelines, null, 2);
  },
  {
    name: "list_pipelines",
    description: "List all configured ingestion pipelines from pipelines.json.",
    schema: z.object({}),
  },
);

/**
 * remove_pipeline — remove a pipeline from pipelines.json.
 */
export const removePipelineTool = tool(
  async ({ name }: { name: string }) => {
    const cwd = process.cwd();
    const removed = await removePipeline(cwd, name);
    return JSON.stringify({ removed, name });
  },
  {
    name: "remove_pipeline",
    description: "Remove a pipeline from pipelines.json by name.",
    schema: z.object({
      name: z.string().describe("Name of the pipeline to remove"),
    }),
  },
);

/**
 * write_connector — let the agent write a custom connector Python script.
 * The script must follow the connector contract: ingest(config, state, inbox_dir) -> new_state
 */
export const writeConnectorTool = tool(
  async ({
    name,
    code,
    configJson,
  }: {
    name: string;
    code: string;
    configJson: string;
  }) => {
    const cwd = process.cwd();
    const connectorDir = path.join(cwd, "connectors", name);
    await mkdir(connectorDir, { recursive: true });
    await writeFile(path.join(connectorDir, "connector.py"), code, "utf8");
    await writeFile(
      path.join(connectorDir, "config.json"),
      configJson,
      "utf8",
    );

    // Register in __init__ so it's importable
    const initContent = `from .connector import ingest  # auto-generated\n`;
    await writeFile(path.join(connectorDir, "__init__.py"), initContent, "utf8");

    return JSON.stringify({
      created: true,
      path: path.join(connectorDir, "connector.py"),
      configPath: path.join(connectorDir, "config.json"),
      message: `Connector '${name}' written. Import as 'connectors.${name}'. Add it to pipelines.json or use create_pipeline to schedule it.`,
    });
  },
  {
    name: "write_connector",
    description:
      "Write a custom Python connector script. The script MUST define an 'ingest(config, state, inbox_dir) -> new_state' function. Credentials must be read from environment variables (os.environ), never hardcoded. A config.json with non-secret parameters will also be written. After writing, tell the user which env var names to set in .env.",
    schema: z.object({
      name: z.string().describe("Connector name (e.g. 'substack', 'linear')"),
      code: z.string().describe("Python source code for the connector"),
      configJson: z.string().describe("JSON string with non-secret config parameters"),
    }),
  },
);

/**
 * run_ingestion — fetch raw data via a connector, then run the update agent
 * to synthesize it into the wiki. This is the "ingest my emails" flow.
 * Returns structured status messages for chat-side user feedback.
 */
export const runIngestionTool = tool(
  async ({
    connector,
    configPath,
  }: {
    connector: string;
    configPath: string;
  }) => {
    const cwd = process.cwd();
    try {
      const result = await runIngestion(connector, configPath, cwd);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({
        connector,
        status: "error",
        messages: [
          `Ingestion started: fetching data from '${connector}'`,
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  {
    name: "run_ingestion",
    description:
      "Run an ingestion: fetch raw data from a connector, then run the update agent to synthesize it into the wiki. Use this when the user says 'ingest my emails', 'fetch my GitHub issues', 'pull in my RSS feeds', etc. This does both the fetch and the LLM synthesis in one step. The result includes a 'messages' array with status updates (start, fetching, synthesizing, completed/error) that you should relay to the user in the chat. Only connectors registered via list_connectors or created via write_connector can be run — you cannot run arbitrary scripts.",
    schema: z.object({
      connector: z.string().describe("Connector name from list_connectors (e.g. 'github', 'rss', 'web', 'local'), or a custom connector created via write_connector"),
      configPath: z.string().describe("Path to the connector config JSON file"),
    }),
  },
);

/**
 * All pipeline/connector tools exported as an array for the agent.
 */
export const pipelineTools = [
  listConnectorsTool,
  checkCredentialsTool,
  createPipelineTool,
  runPipelineTool,
  runIngestionTool,
  listPipelinesTool,
  removePipelineTool,
  writeConnectorTool,
];
