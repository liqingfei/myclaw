import type { CliBackendPlugin } from "openclaw/plugin-sdk/cli-backend";
import { describe, expect, it } from "vitest";
import setupEntry from "./setup-api.js";

function register(pluginConfig?: unknown): CliBackendPlugin {
  let registered: CliBackendPlugin | undefined;
  setupEntry.register({
    pluginConfig,
    registerCliBackend(backend: CliBackendPlugin) {
      registered = backend;
    },
  } as never);
  if (!registered) {
    throw new Error("Qoder CLI backend was not registered");
  }
  return registered;
}

describe("Qoder CLI setup entry", () => {
  it("registers stream-json argv using positional prompts", () => {
    const backend = register();

    expect(backend.id).toBe("qoder");
    expect(backend.config).toMatchObject({
      command: "qodercli",
      args: ["-p", "-o", "stream-json", "{prompt}"],
      resumeArgs: ["-p", "-o", "stream-json", "-r", "{sessionId}", "{prompt}"],
      output: "jsonl",
      resumeOutput: "jsonl",
      input: "arg",
      modelArg: "-m",
      sessionMode: "existing",
      systemPromptArg: "--append-system-prompt",
      systemPromptMode: "append",
      serialize: true,
    });
  });

  it("honors the existing plugin command override", () => {
    expect(register({ cliBackend: { command: "/opt/qodercli" } }).config.command).toBe(
      "/opt/qodercli",
    );
  });
});
