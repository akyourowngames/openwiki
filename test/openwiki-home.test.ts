import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  OPENWIKI_CONFIG_DIR_ENV_KEY,
  resolveOpenWikiHomeDir,
} from "../src/openwiki-home.ts";

describe("resolveOpenWikiHomeDir", () => {
  test("uses the default directory when no override is configured", () => {
    expect(resolveOpenWikiHomeDir({})).toBe(
      path.join(os.homedir(), ".openwiki"),
    );
  });

  test("uses a configured directory for all local OpenWiki state", () => {
    expect(
      resolveOpenWikiHomeDir({
        [OPENWIKI_CONFIG_DIR_ENV_KEY]: "C:/openwiki-state",
      }),
    ).toBe(path.resolve("C:/openwiki-state"));
  });

  test("treats whitespace-only overrides as unset", () => {
    expect(
      resolveOpenWikiHomeDir({ [OPENWIKI_CONFIG_DIR_ENV_KEY]: "  " }),
    ).toBe(resolveOpenWikiHomeDir({}));
  });
});
