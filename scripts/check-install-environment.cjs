#!/usr/bin/env node

function isBunInstall(env, versions) {
  return (
    Boolean(versions.bun) ||
    /\bbun\//iu.test(env.npm_config_user_agent || "") ||
    /(?:^|[\\/])bun(?:\.exe)?$/iu.test(env.npm_execpath || "")
  );
}

function shouldWarnForBunWindows(env, versions, platform) {
  return platform === "win32" && isBunInstall(env, versions);
}

function getBunWindowsWarning() {
  return [
    "",
    "OpenWiki install notice:",
    "  Windows + Bun may need a local C++ toolchain because better-sqlite3",
    "  does not currently use the same prebuilt binary path under Bun.",
    "",
    "  Recommended options:",
    "  - Install OpenWiki with npm or pnpm on Node.js.",
    "  - Or install Visual Studio Build Tools with the Desktop development",
    "    with C++ workload before running bun install -g openwiki.",
    "",
  ].join("\n");
}

if (shouldWarnForBunWindows(process.env, process.versions, process.platform)) {
  process.stderr.write(getBunWindowsWarning());
}

module.exports = {
  getBunWindowsWarning,
  isBunInstall,
  shouldWarnForBunWindows,
};
