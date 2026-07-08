import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { getBunWindowsWarning, isBunInstall, shouldWarnForBunWindows } =
  require("../scripts/check-install-environment.cjs") as {
    getBunWindowsWarning: () => string;
    isBunInstall: (
      env: Record<string, string | undefined>,
      versions: Record<string, string | undefined>,
    ) => boolean;
    shouldWarnForBunWindows: (
      env: Record<string, string | undefined>,
      versions: Record<string, string | undefined>,
      platform: NodeJS.Platform,
    ) => boolean;
  };

describe("check-install-environment", () => {
  test("detects Bun from user agent, exec path, or runtime version", () => {
    expect(isBunInstall({ npm_config_user_agent: "bun/1.3.14" }, {})).toBe(
      true,
    );
    expect(isBunInstall({ npm_execpath: "C:\\Users\\me\\bun.exe" }, {})).toBe(
      true,
    );
    expect(isBunInstall({}, { bun: "1.3.14" })).toBe(true);
    expect(isBunInstall({ npm_config_user_agent: "pnpm/10.33.2" }, {})).toBe(
      false,
    );
  });

  test("warns only for Bun installs on Windows", () => {
    expect(
      shouldWarnForBunWindows(
        { npm_config_user_agent: "bun/1.3.14" },
        {},
        "win32",
      ),
    ).toBe(true);
    expect(
      shouldWarnForBunWindows(
        { npm_config_user_agent: "bun/1.3.14" },
        {},
        "linux",
      ),
    ).toBe(false);
    expect(
      shouldWarnForBunWindows(
        { npm_config_user_agent: "npm/11.0.0" },
        {},
        "win32",
      ),
    ).toBe(false);
  });

  test("warning gives Windows users an actionable install path", () => {
    const warning = getBunWindowsWarning();

    expect(warning).toContain("Windows + Bun");
    expect(warning).toContain("npm or pnpm");
    expect(warning).toContain("Visual Studio Build Tools");
  });
});
