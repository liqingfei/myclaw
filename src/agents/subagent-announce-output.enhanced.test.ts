/**
 * Tests for the enhanced subagent-announce-output wrapper.
 *
 * Covers:
 *   - assistantFragments multi-fragment collection and join
 *   - maxMessages=500 (larger fetch window)
 *   - readLatestAssistantReply fallback
 *   - readLatestSubagentOutputWithRetry and captureSubagentCompletionReply delegation
 *   - barrel re-export of upstream functions
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  testing,
  readSubagentOutput,
  readLatestSubagentOutputWithRetry,
  captureSubagentCompletionReply,
  applySubagentWaitOutcome,
  buildChildCompletionFindings,
  buildCompactAnnounceStatsLine,
  waitForSubagentRunOutcome,
  withSubagentOutcomeTiming,
} from "./subagent-announce-output.enhanced.js";

type ReadSessionMessagesAsync =
  typeof import("./subagent-announce.runtime.js").readSessionMessagesAsync;

function installDeps(params: {
  messages?: Array<unknown>;
  transcriptMessages?: Array<unknown>;
  latestAssistantReply?: string;
}) {
  const callGateway = vi.fn(async () => ({
    messages: params.messages ?? [],
  }));
  const readSessionMessagesAsync = vi.fn(async () => params.transcriptMessages ?? []);
  const readLatestAssistantReply = vi.fn(async () => params.latestAssistantReply);
  testing.setDepsForTest({
    callGateway:
      callGateway as unknown as typeof import("./subagent-announce.runtime.js").callGateway,
    readSessionMessagesAsync: readSessionMessagesAsync as unknown as ReadSessionMessagesAsync,
    readLatestAssistantReply:
      readLatestAssistantReply as unknown as typeof import("./tools/agent-step.js").readLatestAssistantReply,
  });
  return { callGateway, readSessionMessagesAsync, readLatestAssistantReply };
}

describe("barrel re-export", () => {
  it("re-exports upstream functions unchanged", () => {
    expect(typeof applySubagentWaitOutcome).toBe("function");
    expect(typeof buildChildCompletionFindings).toBe("function");
    expect(typeof buildCompactAnnounceStatsLine).toBe("function");
    expect(typeof waitForSubagentRunOutcome).toBe("function");
    expect(typeof withSubagentOutcomeTiming).toBe("function");
  });
});

describe("readSubagentOutput (enhanced)", () => {
  afterEach(() => {
    testing.setDepsForTest();
  });

  it("uses maxMessages=500 when reading transcript messages", async () => {
    const deps = installDeps({
      transcriptMessages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "hello from transcript" }],
        },
      ],
    });

    await expect(
      readSubagentOutput("agent:main:subagent:child", undefined, {
        sessionFile: "/tmp/test.jsonl",
      }),
    ).resolves.toBe("hello from transcript");

    expect(deps.readSessionMessagesAsync).toHaveBeenCalledWith(expect.any(Object), {
      mode: "recent",
      maxMessages: 500,
      maxBytes: 1024 * 1024,
    });
  });

  it("uses limit=500 when calling chat.history", async () => {
    const deps = installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "hello from history" }],
        },
      ],
    });

    await expect(readSubagentOutput("agent:main:subagent:child")).resolves.toBe(
      "hello from history",
    );

    expect(deps.callGateway).toHaveBeenCalledWith({
      method: "chat.history",
      params: { sessionKey: "agent:main:subagent:child", limit: 500 },
    });
  });

  it("falls back to readLatestAssistantReply when no output found", async () => {
    const deps = installDeps({
      messages: [],
      latestAssistantReply: "fallback reply text",
    });

    const result = await readSubagentOutput("agent:main:subagent:child");
    expect(result).toBe("fallback reply text");
    expect(deps.readLatestAssistantReply).toHaveBeenCalledWith({
      sessionKey: "agent:main:subagent:child",
      limit: 500,
    });
  });

  it("does not fall back when waiting for continuation", async () => {
    // sessions_yield turn means the subagent is still running
    const deps = installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Waiting for subagent completion." },
            {
              type: "toolCall",
              id: "call-yield",
              name: "sessions_yield",
              arguments: { message: "Waiting for subagent completion." },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call-yield",
          toolName: "sessions_yield",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "yielded", message: "Waiting for subagent completion." },
                null,
                2,
              ),
            },
          ],
          details: { status: "yielded", message: "Waiting for subagent completion." },
        },
      ],
    });

    const result = await readSubagentOutput("agent:main:subagent:child");
    expect(result).toBeUndefined();
    expect(deps.readLatestAssistantReply).not.toHaveBeenCalled();
  });

  it("joins multiple assistant fragments with --- separator", async () => {
    installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "First fragment." }],
        },
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Second fragment." }],
        },
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Third fragment." }],
        },
      ],
    });

    const result = await readSubagentOutput("agent:main:subagent:child");
    expect(result).toBe("First fragment.\n\n---\n\nSecond fragment.\n\n---\n\nThird fragment.");
  });

  it("returns single fragment without separator", async () => {
    installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Only fragment." }],
        },
      ],
    });

    const result = await readSubagentOutput("agent:main:subagent:child");
    expect(result).toBe("Only fragment.");
  });

  it("resets fragments after sessions_yield", async () => {
    installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Pre-yield fragment." }],
        },
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Waiting." },
            {
              type: "toolCall",
              id: "call-yield",
              name: "sessions_yield",
              arguments: {},
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call-yield",
          toolName: "sessions_yield",
          content: [{ type: "text", text: JSON.stringify({ status: "yielded" }) }],
          details: { status: "yielded" },
        },
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Post-yield fragment." }],
        },
      ],
    });

    // Only the post-yield fragment should be returned (pre-yield is cleared)
    const result = await readSubagentOutput("agent:main:subagent:child");
    expect(result).toBe("Post-yield fragment.");
  });

  it("resets fragments after silent reply", async () => {
    installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Pre-silent fragment." }],
        },
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "NO_REPLY" }],
        },
      ],
    });

    // The silent reply token (NO_REPLY) should be returned as the latest
    // non-empty text that matches the silent pattern. assistantFragments
    // is cleared when a silent reply is encountered, so only the silent
    // reply is returned (not the pre-silent fragment).
    const result = await readSubagentOutput("agent:main:subagent:child");
    expect(result).toBe("NO_REPLY");
  });
});

describe("readLatestSubagentOutputWithRetry (enhanced)", () => {
  afterEach(() => {
    testing.setDepsForTest();
  });

  it("delegates to enhanced readSubagentOutput", async () => {
    installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "First." }],
        },
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Second." }],
        },
      ],
    });

    const result = await readLatestSubagentOutputWithRetry({
      sessionKey: "agent:main:subagent:child",
      maxWaitMs: 1000,
    });

    // Should get multi-fragment joined output from the enhanced readSubagentOutput
    expect(result).toBe("First.\n\n---\n\nSecond.");
  });
});

describe("captureSubagentCompletionReply (enhanced)", () => {
  afterEach(() => {
    testing.setDepsForTest();
  });

  it("delegates to enhanced readSubagentOutput", async () => {
    installDeps({
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Fragment A." }],
        },
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Fragment B." }],
        },
      ],
    });

    const result = await captureSubagentCompletionReply("agent:main:subagent:child");
    expect(result).toBe("Fragment A.\n\n---\n\nFragment B.");
  });

  it("respects waitForReply=false", async () => {
    // No messages and no fallback reply: waitForReply=false means
    // captureSubagentCompletionReply should return undefined without
    // entering the retry loop. The immediate readSubagentOutput call
    // returns undefined because there are no messages and no fallback.
    installDeps({
      messages: [],
    });

    const result = await captureSubagentCompletionReply("agent:main:subagent:child", {
      waitForReply: false,
    });
    expect(result).toBeUndefined();
  });
});

describe("testing helpers", () => {
  afterEach(() => {
    testing.setDepsForTest();
  });

  it("exposes enhanced summarizeSubagentOutputHistory", () => {
    const { summarizeSubagentOutputHistory } = testing;

    const messages = [
      { role: "assistant", content: [{ type: "text", text: "Alpha." }] },
      { role: "assistant", content: [{ type: "text", text: "Beta." }] },
    ];

    const snapshot = summarizeSubagentOutputHistory(messages);
    expect(snapshot.assistantFragments).toEqual(["Alpha.", "Beta."]);
    expect(snapshot.latestAssistantText).toBe("Beta.");
  });

  it("exposes enhanced selectSubagentOutputText for multi-fragment", () => {
    const { selectSubagentOutputText } = testing;

    const snapshot = {
      assistantFragments: ["One.", "Two.", "Three."],
      latestAssistantText: "Three.",
    };

    const result = selectSubagentOutputText(snapshot);
    expect(result).toBe("One.\n\n---\n\nTwo.\n\n---\n\nThree.");
  });

  it("exposes enhanced selectSubagentOutputText for single fragment", () => {
    const { selectSubagentOutputText } = testing;

    const snapshot = {
      assistantFragments: ["Only one."],
      latestAssistantText: "Only one.",
    };

    const result = selectSubagentOutputText(snapshot);
    expect(result).toBe("Only one.");
  });
});
