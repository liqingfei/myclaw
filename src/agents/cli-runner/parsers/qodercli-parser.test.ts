import { describe, expect, it } from "vitest";
import { qoderCliParser } from "./qodercli-parser.js";

describe("qoderCliParser", () => {
  it("parses assistant message content blocks", () => {
    const event = qoderCliParser.parseLine(
      JSON.stringify({
        type: "assistant",
        subtype: "message",
        session_id: "session-1",
        message: {
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: " world" },
          ],
        },
      }),
      { backend: { command: "qodercli" }, providerId: "qodercli", textSoFar: "" },
    );

    expect(event).toEqual({
      text: "Hello world",
      delta: "Hello world",
      final: false,
      sessionId: "session-1",
      usage: undefined,
    });
  });

  it("marks done result events as final and extracts usage", () => {
    const event = qoderCliParser.parseLine(
      JSON.stringify({
        type: "result",
        done: true,
        message: { content: [{ type: "text", text: "Done" }] },
        usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3 },
      }),
      { backend: { command: "qodercli" }, providerId: "qodercli", textSoFar: "partial" },
    );

    expect(event).toEqual({
      text: "Done",
      delta: "Done",
      final: true,
      sessionId: undefined,
      usage: {
        input: 10,
        output: 4,
        cacheRead: 3,
        cacheWrite: undefined,
        total: undefined,
      },
    });
  });
});
