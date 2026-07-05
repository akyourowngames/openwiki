import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ConnectorInfo,
  type CredentialStatus,
  type Pipeline,
  type PipelinesConfig,
  PIPELINES_FILE,
  PREBUILT_CONNECTORS,
} from "./types.js";

export function listPrebuiltConnectors(): ConnectorInfo[] {
  return PREBUILT_CONNECTORS;
}

export function getPrebuiltConnector(name: string): ConnectorInfo | undefined {
  return PREBUILT_CONNECTORS.find((c) => c.name === name);
}

export async function loadPipelines(
  cwd: string,
): Promise<PipelinesConfig> {
  const filePath = path.join(cwd, PIPELINES_FILE);
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as PipelinesConfig;
  } catch {
    return { pipelines: [] };
  }
}

export async function savePipelines(
  cwd: string,
  config: PipelinesConfig,
): Promise<void> {
  const filePath = path.join(cwd, PIPELINES_FILE);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function addPipeline(
  cwd: string,
  pipeline: Pipeline,
): Promise<Pipeline> {
  const config = await loadPipelines(cwd);
  config.pipelines = config.pipelines.filter((p) => p.name !== pipeline.name);
  config.pipelines.push(pipeline);
  await savePipelines(cwd, config);
  return pipeline;
}

export async function listPipelines(cwd: string): Promise<Pipeline[]> {
  const config = await loadPipelines(cwd);
  return config.pipelines;
}

export async function getPipeline(
  cwd: string,
  name: string,
): Promise<Pipeline | undefined> {
  const config = await loadPipelines(cwd);
  return config.pipelines.find((p) => p.name === name);
}

export async function removePipeline(
  cwd: string,
  name: string,
): Promise<boolean> {
  const config = await loadPipelines(cwd);
  const before = config.pipelines.length;
  config.pipelines = config.pipelines.filter((p) => p.name !== name);
  if (config.pipelines.length < before) {
    await savePipelines(cwd, config);
    return true;
  }
  return false;
}

export function checkConnectorCredentials(
  connector: ConnectorInfo,
): { required: CredentialStatus[]; optional: CredentialStatus[] } {
  return {
    required: connector.requiredEnvVars.map((envVar) => ({
      envVar,
      set: !!process.env[envVar],
    })),
    optional: connector.optionalEnvVars.map((envVar) => ({
      envVar,
      set: !!process.env[envVar],
    })),
  };
}
