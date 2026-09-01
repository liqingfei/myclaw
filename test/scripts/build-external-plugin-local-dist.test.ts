import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const buildPluginNpmRuntime = vi.hoisted(() => vi.fn());

vi.mock("../../scripts/lib/plugin-npm-runtime-build.mts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../scripts/lib/plugin-npm-runtime-build.mts")>()),
  buildPluginNpmRuntime,
}));

import {
  buildExternalPluginLocalDist,
  listExternalPluginLocalDistPackageDirs,
} from "../../scripts/build-external-plugin-local-dist.mts";
import {
  collectRootPackageExcludedExtensionDirs,
  DOCKER_SELECTED_PLUGIN_BUILD_IDS_ENV,
} from "../../scripts/lib/bundled-plugin-build-entries.mjs";

const fixturePluginId = "fixture-plugin";

describe("external plugin local dist build", () => {
  afterEach(() => {
    buildPluginNpmRuntime.mockReset();
    vi.restoreAllMocks();
  });

  it("selects every externalized first-party plugin behind a package exclusion", () => {
    const packageDirs = listExternalPluginLocalDistPackageDirs();
    const excludedPluginIds = collectRootPackageExcludedExtensionDirs();

    expect(packageDirs).toHaveLength(63);
    expect(packageDirs).toEqual(
      expect.arrayContaining([
        "extensions/diffs",
        "extensions/diffs-language-pack",
        "extensions/slack",
        "extensions/sms",
        "extensions/mxc",
      ]),
    );
    expect(packageDirs).not.toContain("extensions/whatsapp");
    expect(
      packageDirs.every((packageDir) => excludedPluginIds.has(packageDir.split("/").at(-1) ?? "")),
    ).toBe(true);
  });

  it("leaves Docker-selected external plugin compilation on the unified build path", () => {
    expect(
      listExternalPluginLocalDistPackageDirs({
        env: {
          ...process.env,
          [DOCKER_SELECTED_PLUGIN_BUILD_IDS_ENV]: "slack",
        },
      }),
    ).toEqual([]);
  });

  it("performs no writes when Docker owns the selected build", async () => {
    await expect(
      buildExternalPluginLocalDist({
        env: {
          ...process.env,
          [DOCKER_SELECTED_PLUGIN_BUILD_IDS_ENV]: "slack",
        },
        logLevel: "silent",
      }),
    ).resolves.toMatchObject({ pluginDirs: [] });
  });

  it("moves package runtime output into the staged dist", async () => {
    const repoRoot = tempDirs.make("openclaw-external-plugin-dist-");
    const packageDir = path.join(repoRoot, "extensions", fixturePluginId);
    const packageOutDir = path.join(packageDir, "dist");
    const targetFile = path.join(repoRoot, "dist", "extensions", fixturePluginId, "index.js");

    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: `@openclaw/${fixturePluginId}`,
        openclaw: {
          build: { bundledDist: false },
          release: { publishToNpm: true },
        },
      }),
    );
    buildPluginNpmRuntime.mockImplementationOnce(async () => {
      fs.mkdirSync(packageOutDir, { recursive: true });
      fs.writeFileSync(path.join(packageOutDir, "index.js"), "export {};\n");
      return { outDir: packageOutDir, pluginDir: fixturePluginId };
    });

    await expect(
      buildExternalPluginLocalDist({ repoRoot, logLevel: "silent" }),
    ).resolves.toMatchObject({ pluginDirs: [fixturePluginId] });
    expect(fs.readFileSync(targetFile, "utf8")).toBe("export {};\n");
    expect(fs.existsSync(packageOutDir)).toBe(false);
  });
});
