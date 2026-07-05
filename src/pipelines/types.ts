export type ConnectorConfig = {
  name: string;
  config: string;
};

export type Pipeline = {
  name: string;
  schedule: string;
  connectors: ConnectorConfig[];
  runAgent: boolean;
};

export type PipelinesConfig = {
  pipelines: Pipeline[];
};

export type ConnectorInfo = {
  name: string;
  module: string;
  description: string;
  requiredEnvVars: string[];
  optionalEnvVars: string[];
};

export type CredentialStatus = {
  envVar: string;
  set: boolean;
};

export const PREBUILT_CONNECTORS: ConnectorInfo[] = [
  {
    name: "web",
    module: "connectors.web",
    description: "Fetch raw JSON/text from one or more HTTP URLs.",
    requiredEnvVars: [],
    optionalEnvVars: ["CONNECTOR_WEB_TOKEN"],
  },
  {
    name: "github",
    module: "connectors.github",
    description: "Fetch recent issues and PRs from a GitHub repository.",
    requiredEnvVars: [],
    optionalEnvVars: ["CONNECTOR_GITHUB_TOKEN"],
  },
  {
    name: "rss",
    module: "connectors.rss",
    description: "Parse RSS/Atom feeds and store entries as JSON.",
    requiredEnvVars: [],
    optionalEnvVars: [],
  },
  {
    name: "local",
    module: "connectors.local",
    description: "Ingest files from a local directory. Accepts a directory path in config, identical in interface to other connectors.",
    requiredEnvVars: [],
    optionalEnvVars: [],
  },
];

export const PIPELINES_FILE = "pipelines.json";
