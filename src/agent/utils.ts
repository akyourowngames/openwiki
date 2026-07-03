import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { OPEN_WIKI_DIR, UPDATE_METADATA_PATH } from "../constants.js";
import type {
  OpenWikiCommand,
  OpenWikiOutputMode,
  RunContext,
  UpdateMetadata,
} from "./types.js";
import type { Dirent } from "node:fs";

const execFileAsync = promisify(execFile);
const LOCAL_WIKI_METADATA_PATH = ".last-update.json";

export type OpenWikiContentSnapshot = string;

/**
 * Builds the per-run context the prompt uses to reason about prior docs and git changes.
 */
export async function createRunContext(
  command: OpenWikiCommand,
  cwd: string,
  outputMode: OpenWikiOutputMode = "repository",
): Promise<RunContext> {
  const lastUpdate = await readLastUpdate(cwd, outputMode);

  if (command === "chat") {
    return {
      lastUpdate,
      gitSummary: "Not applicable for chat.",
    };
  }

  if (outputMode === "local-wiki") {
    return {
      lastUpdate,
      gitSummary:
        "Local wiki mode: connector source evidence is provided through raw data paths and OpenWiki connector tools. Git repository diff context is not used for this run.",
    };
  }

  return {
    lastUpdate,
    gitSummary: await createGitSummary(command, cwd, lastUpdate),
  };
}

/**
 * Records a successful init/update run so future updates can diff from this git head.
 */
export async function writeLastUpdateMetadata(
  command: OpenWikiCommand,
  cwd: string,
  modelId: string,
  outputMode: OpenWikiOutputMode = "repository",
): Promise<void> {
  const metadataFile = getMetadataFilePath(cwd, outputMode);
  const metadata: UpdateMetadata = {
    updatedAt: new Date().toISOString(),
    command,
    gitHead: outputMode === "repository" ? await getGitHead(cwd) : undefined,
    model: modelId,
  };

  await mkdir(path.dirname(metadataFile), { recursive: true });
  await writeFile(
    metadataFile,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Hashes OpenWiki content, excluding run metadata, to detect real documentation changes.
 */
export async function createOpenWikiContentSnapshot(
  cwd: string,
  outputMode: OpenWikiOutputMode = "repository",
): Promise<OpenWikiContentSnapshot> {
  const openWikiDir = getWikiContentRoot(cwd, outputMode);
  const hash = createHash("sha256");

  await addDirectoryToSnapshot(hash, openWikiDir, "");

  return hash.digest("hex");
}

/**
 * Reads prior run metadata if it exists and is structurally valid.
 */
async function readLastUpdate(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): Promise<UpdateMetadata | null> {
  const metadataFile = getMetadataFilePath(cwd, outputMode);

  try {
    const rawMetadata = await readFile(metadataFile, "utf8");
    const parsedMetadata = JSON.parse(rawMetadata) as Partial<UpdateMetadata>;

    if (
      typeof parsedMetadata.updatedAt === "string" &&
      typeof parsedMetadata.command === "string" &&
      typeof parsedMetadata.model === "string"
    ) {
      return {
        updatedAt: parsedMetadata.updatedAt,
        command: parsedMetadata.command === "init" ? "init" : "update",
        gitHead:
          typeof parsedMetadata.gitHead === "string"
            ? parsedMetadata.gitHead
            : undefined,
        model: parsedMetadata.model,
      };
    }

    return null;
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

/**
 * Recursively adds stable file paths and bytes to the OpenWiki content snapshot.
 */
async function addDirectoryToSnapshot(
  hash: ReturnType<typeof createHash>,
  directory: string,
  relativeDirectory: string,
): Promise<void> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isExpectedSnapshotRaceError(error)) {
      hash.update("missing");
      return;
    }

    throw error;
  }

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name);

    if (
      relativePath === path.basename(UPDATE_METADATA_PATH) ||
      relativePath === LOCAL_WIKI_METADATA_PATH
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      hash.update(`dir:${relativePath}\0`);
      await addDirectoryToSnapshot(hash, entryPath, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileContent = await readSnapshotFile(entryPath);

    if (fileContent === null) {
      continue;
    }

    hash.update(`file:${relativePath}\0`);
    hash.update(fileContent);
    hash.update("\0");
  }
}

function getWikiContentRoot(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): string {
  return outputMode === "local-wiki" ? cwd : path.join(cwd, OPEN_WIKI_DIR);
}

function getMetadataFilePath(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): string {
  return outputMode === "local-wiki"
    ? path.join(cwd, LOCAL_WIKI_METADATA_PATH)
    : path.join(cwd, UPDATE_METADATA_PATH);
}

/**
 * Reads snapshot bytes while tolerating files that move mid-scan.
 */
async function readSnapshotFile(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isExpectedSnapshotRaceError(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * Produces the git evidence block passed to init/update prompts.
 */
async function createGitSummary(
  command: OpenWikiCommand,
  cwd: string,
  lastUpdate: UpdateMetadata | null,
): Promise<string> {
  const sections: string[] = [];
  const status = await runGit(cwd, ["status", "--short"]);
  const head = await getGitHead(cwd);

  sections.push(formatGitSection("git status --short", status));
  sections.push(formatGitSection("git rev-parse HEAD", head ?? "(unknown)"));

  if (command === "update" && lastUpdate?.gitHead) {
    const logSinceLastHead = await runGit(cwd, [
      "log",
      `${lastUpdate.gitHead}..HEAD`,
      "--name-status",
      "--oneline",
    ]);

    sections.push(
      formatGitSection(
        `git log ${lastUpdate.gitHead}..HEAD --name-status --oneline`,
        logSinceLastHead,
      ),
    );
  } else if (command === "update" && lastUpdate?.updatedAt) {
    const logSinceLastUpdate = await runGit(cwd, [
      "log",
      "--since",
      lastUpdate.updatedAt,
      "--name-status",
      "--oneline",
    ]);

    sections.push(
      formatGitSection(
        `git log --since ${lastUpdate.updatedAt} --name-status --oneline`,
        logSinceLastUpdate,
      ),
    );
  } else {
    const recentLog = await runGit(cwd, [
      "log",
      "--max-count=20",
      "--name-status",
      "--oneline",
    ]);

    if (command === "update") {
      sections.push("No prior OpenWiki update timestamp was found.");
    }

    sections.push(
      formatGitSection(
        "git log --max-count=20 --name-status --oneline",
        recentLog,
      ),
    );
  }

  const diff = await runGit(cwd, ["diff", "--name-status", "HEAD"]);
  sections.push(formatGitSection("git diff --name-status HEAD", diff));

  return sections.join("\n\n");
}

async function getGitHead(cwd: string): Promise<string | undefined> {
  const head = await runGit(cwd, ["rev-parse", "HEAD"]);

  return head.length > 0 ? head : undefined;
}

/**
 * Runs git commands without failing the whole run for normal git command errors.
 */
async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["--no-pager", ...args],
      {
        cwd,
        maxBuffer: 1024 * 1024,
      },
    );

    return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
  } catch (error) {
    if (isExecError(error)) {
      return [error.stdout?.trim(), error.stderr?.trim()]
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    throw error;
  }
}

function formatGitSection(command: string, output: string): string {
  return [`$ ${command}`, output.length > 0 ? output : "(no output)"].join(
    "\n",
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isExpectedSnapshotRaceError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  return ["EISDIR", "ENOENT", "ENOTDIR"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );
}

function isExecError(
  error: unknown,
): error is Error & { stdout?: string; stderr?: string } {
  return error instanceof Error && ("stdout" in error || "stderr" in error);
}
