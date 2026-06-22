import { describe, expect, it } from "vitest";
import { buildQoderCliBackend } from "./cli-backend.js";

function parse(line: unknown) {
  const backend = buildQoderCliBackend();
  return backend.parseJsonlEvent?.(JSON.stringify(line), {
    backendId: backend.id,
    backend: backend.config,
  });
}

describe("Qoder CLI JSONL output", () => {
  it("projects assistant content blocks and session identity", () => {
    expect(
      parse({
        type: "assistant",
        session_id: "session-1",
        message: {
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: " world" },
          ],
        },
      }),
    ).toEqual([
      { kind: "sessionId", sessionId: "session-1" },
      { kind: "text", text: "Hello world" },
    ]);
  });

  it("terminates done results after preserving their final text and usage", () => {
    expect(
      parse({
        type: "result",
        done: true,
        message: { content: [{ type: "text", text: "Done" }] },
        usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3 },
      }),
    ).toEqual([
      { kind: "text", text: "\nDone" },
      {
        kind: "result",
        usage: {
          input: 10,
          output: 4,
          cacheRead: 3,
          cacheWrite: undefined,
          total: undefined,
        },
      },
    ]);
  });
});
