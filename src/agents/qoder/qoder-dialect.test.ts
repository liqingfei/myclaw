import { describe, expect, it } from "vitest";
import { createCliJsonlStreamingParser, parseCliJsonl } from "../cli-output.enhanced.js";

describe("qoder CLI output dialect", () => {
  it("parses qoder stream-json events for an explicit backend dialect", () => {
    const result = parseCliJsonl(
      [
        JSON.stringify({
          type: "assistant",
          session_id: "qoder-session",
          message: { content: [{ type: "text", text: "first" }] },
        }),
        JSON.stringify({
          type: "result",
          done: true,
          message: { content: [{ type: "text", text: "done" }] },
        }),
      ].join("\n"),
      {
        command: "local-cli",
        output: "jsonl",
        jsonlDialect: "qoder-stream-json",
        sessionIdFields: ["session_id"],
      },
      "local-cli",
    );

    expect(result).toEqual({
      text: "first\ndone",
      sessionId: "qoder-session",
      usage: undefined,
    });
  });

  it("streams qoder stream-json parser deltas for an explicit backend dialect", () => {
    const deltas: Array<{ text: string; delta: string; sessionId?: string }> = [];
    const parser = createCliJsonlStreamingParser({
      backend: {
        command: "local-cli",
        output: "jsonl",
        jsonlDialect: "qoder-stream-json",
        sessionIdFields: ["session_id"],
      },
      providerId: "local-cli",
      onAssistantDelta: (delta) => deltas.push(delta),
    });

    parser.push(
      [
        JSON.stringify({
          type: "assistant",
          session_id: "qoder-session",
          message: { content: [{ type: "text", text: "first" }] },
        }),
        JSON.stringify({
          type: "result",
          done: true,
          message: { content: [{ type: "text", text: "done" }] },
        }),
      ].join("\n"),
    );
    parser.finish();

    expect(deltas).toEqual([
      { text: "first", delta: "first", sessionId: "qoder-session" },
      { text: "first\ndone", delta: "done", sessionId: "qoder-session" },
    ]);
    expect(parser.getOutput()).toEqual({
      text: "first\ndone",
      sessionId: "qoder-session",
      usage: undefined,
    });
  });
});
