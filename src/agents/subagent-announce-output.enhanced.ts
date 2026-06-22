/**
 * Enhanced wrapper for subagent-announce-output.ts.
 *
 * Barrel re-export of all upstream exports, with enhanced overrides for:
 *   - readSubagentOutput (maxMessages 500, assistantFragments multi-fragment join,
 *     readLatestAssistantReply fallback)
 *   - readLatestSubagentOutputWithRetry (uses enhanced readSubagentOutput)
 *   - captureSubagentCompletionReply (uses enhanced readSubagentOutput)
 *
 * Sync markers for the enhanced logic:
 *   - summarizeSubagentOutputHistory: based on upstream @ v2026.6.9
 *     + enhancement: assistantFragments[] collection + reset on yield/silent
 *   - selectSubagentOutputText: based on upstream @ v2026.6.9
 *     + enhancement: multi-fragment join with "\n\n---\n\n" separator
 *   - readSubagentOutput: based on upstream @ v2026.6.9
 *     + enhancement: maxMessages=500, readLatestAssistantReply fallback
 *
 * When rebasing onto a new upstream release, compare the upstream functions
 * (summarizeSubagentOutputHistory, selectSubagentOutputText, readSubagentOutput)
 * with the enhanced versions below and update the enhanced logic accordingly.
 */

// ---------------------------------------------------------------------------
// Re-export all upstream exports that do NOT need enhancement
// ---------------------------------------------------------------------------
export {
  applySubagentWaitOutcome,
  buildChildCompletionFindings,
  buildCompactAnnounceStatsLine,
  dedupeLatestChildCompletionRows,
  filterCurrentDirectChildCompletionRows,
  waitForSubagentRunOutcome,
  withSubagentOutcomeTiming,
  __testing as upstreamTesting,
} from "./subagent-announce-output.js";
export type { SubagentRunOutcome } from "./subagent-announce-output.js";

// ---------------------------------------------------------------------------
// Enhanced logic dependencies
// ---------------------------------------------------------------------------
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { readLatestAssistantReply } from "./run-wait.js";
import {
  captureSubagentCompletionReplyUsing,
  readLatestSubagentOutputWithRetryUsing,
} from "./subagent-announce-capture.js";
import { callGateway, readSessionMessagesAsync } from "./subagent-announce.runtime.js";
import { assistantCallsSessionsYield, isSessionsYieldToolResult } from "./subagent-yield-output.js";
import { extractAssistantText, sanitizeTextContent } from "./tools/chat-history-text.js";
import { isAnnounceSkip } from "./tools/sessions-send-tokens.js";

// ---------------------------------------------------------------------------
// Enhanced types (adds assistantFragments to the upstream snapshot shape)
// ---------------------------------------------------------------------------
type SubagentOutputSnapshot = {
  latestAssistantText?: string;
  latestSilentText?: string;
  latestToolCallCount?: number;
  assistantFragments: string[];
  waitingForContinuation?: boolean;
};

// SubagentRunOutcome is re-exported from upstream (see top of file).
// Import it for local use in function signatures:
import type { SubagentRunOutcome } from "./subagent-announce-output.js";

// ---------------------------------------------------------------------------
// Deferred deps: default to the runtime deps, but allow tests to override
// ---------------------------------------------------------------------------
type EnhancedAnnounceOutputDeps = {
  callGateway: typeof callGateway;
  readLatestAssistantReply: typeof readLatestAssistantReply;
  readSessionMessagesAsync: typeof readSessionMessagesAsync;
};

const defaultEnhancedDeps: EnhancedAnnounceOutputDeps = {
  callGateway,
  readLatestAssistantReply,
  readSessionMessagesAsync,
};

let enhancedDeps: EnhancedAnnounceOutputDeps = defaultEnhancedDeps;

// ---------------------------------------------------------------------------
// Helper functions (enhanced copies of upstream private helpers)
// ---------------------------------------------------------------------------

function extractSubagentAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const role = (message as { role?: unknown }).role;
  if (role !== "assistant") {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return sanitizeTextContent(content);
  }
  return extractAssistantText(message) ?? "";
}

function countAssistantToolCalls(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }
  const content = (message as { content?: unknown }).content;
  const contentToolCalls = Array.isArray(content)
    ? content.filter(
        (block) =>
          block &&
          typeof block === "object" &&
          ((block as { type?: unknown }).type === "toolCall" ||
            (block as { type?: unknown }).type === "tool_use"),
      ).length
    : 0;
  const toolCalls =
    (message as { toolCalls?: unknown; tool_calls?: unknown }).toolCalls ??
    (message as { tool_calls?: unknown }).tool_calls;
  return contentToolCalls + (Array.isArray(toolCalls) ? toolCalls.length : 0);
}

/**
 * Enhanced: tracks assistantFragments[] for multi-fragment output merging.
 * Based on upstream @ v2026.6.9 summarizeSubagentOutputHistory.
 */
function summarizeSubagentOutputHistory(messages: Array<unknown>): SubagentOutputSnapshot {
  const snapshot: SubagentOutputSnapshot = { assistantFragments: [] };
  let previousAssistantCalledYield = false;
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = (message as { role?: unknown }).role;
    if (role === "assistant") {
      if (assistantCallsSessionsYield(message)) {
        snapshot.latestAssistantText = undefined;
        snapshot.latestSilentText = undefined;
        snapshot.assistantFragments = [];
        snapshot.waitingForContinuation = true;
        previousAssistantCalledYield = true;
        continue;
      }
      const text = extractSubagentAssistantText(message).trim();
      if (!text) {
        snapshot.latestToolCallCount =
          (snapshot.latestToolCallCount ?? 0) + countAssistantToolCalls(message);
        snapshot.waitingForContinuation = false;
        previousAssistantCalledYield = false;
        continue;
      }
      if (isAnnounceSkip(text) || isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
        snapshot.latestSilentText = text;
        snapshot.latestAssistantText = undefined;
        snapshot.assistantFragments = [];
        snapshot.waitingForContinuation = false;
        previousAssistantCalledYield = false;
        continue;
      }
      snapshot.latestSilentText = undefined;
      snapshot.latestAssistantText = text;
      snapshot.assistantFragments.push(text);
      snapshot.waitingForContinuation = false;
      previousAssistantCalledYield = false;
      continue;
    }
    if (isSessionsYieldToolResult(message, previousAssistantCalledYield)) {
      snapshot.latestAssistantText = undefined;
      snapshot.latestSilentText = undefined;
      snapshot.assistantFragments = [];
      snapshot.waitingForContinuation = true;
      previousAssistantCalledYield = false;
      continue;
    }
    previousAssistantCalledYield = false;
  }
  return snapshot;
}

/**
 * Enhanced: when multiple assistant fragments exist, join them instead of
 * returning only the last (often just a closing remark).
 * Based on upstream @ v2026.6.9 selectSubagentOutputText.
 */
function selectSubagentOutputText(snapshot: SubagentOutputSnapshot): string | undefined {
  if (snapshot.waitingForContinuation) {
    return undefined;
  }
  if (snapshot.latestSilentText) {
    return snapshot.latestSilentText;
  }
  // Enhanced: join multiple assistant fragments so the full output is preserved
  if (snapshot.assistantFragments.length > 1) {
    return snapshot.assistantFragments.join("\n\n---\n\n");
  }
  if (snapshot.latestAssistantText) {
    return snapshot.latestAssistantText;
  }
  if (snapshot.latestToolCallCount && snapshot.latestToolCallCount > 0) {
    return `${snapshot.latestToolCallCount} tool call(s) made without visible output.`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Enhanced exported functions
// ---------------------------------------------------------------------------

/**
 * Enhanced: uses maxMessages=500 and readLatestAssistantReply fallback.
 */
export async function readSubagentOutput(
  sessionKey: string,
  _outcome?: SubagentRunOutcome,
  options?: { sessionFile?: string },
): Promise<string | undefined> {
  let messages: unknown[] | undefined;
  if (options?.sessionFile) {
    const transcriptMessages = await enhancedDeps.readSessionMessagesAsync(
      {
        sessionFile: options.sessionFile,
        sessionId: sessionKey,
      },
      {
        mode: "recent",
        maxMessages: 500,
        maxBytes: 1024 * 1024,
      },
    );
    messages = transcriptMessages;
  }
  const history =
    messages === undefined
      ? await enhancedDeps.callGateway({
          method: "chat.history",
          params: { sessionKey, limit: 500 },
        })
      : undefined;
  const sourceMessages = messages ?? (Array.isArray(history?.messages) ? history.messages : []);
  const snapshot = summarizeSubagentOutputHistory(sourceMessages);
  const selected = selectSubagentOutputText(snapshot);
  if (selected?.trim()) {
    return selected;
  }
  // Enhanced: fallback to readLatestAssistantReply when no output found
  if (snapshot.waitingForContinuation) {
    return undefined;
  }
  const latestAssistant = await enhancedDeps.readLatestAssistantReply({
    sessionKey,
    limit: 500,
  });
  return latestAssistant?.trim() ? latestAssistant : undefined;
}

/**
 * Enhanced: uses the enhanced readSubagentOutput (with maxMessages=500 + fallback).
 */
export async function readLatestSubagentOutputWithRetry(params: {
  sessionKey: string;
  maxWaitMs: number;
  outcome?: SubagentRunOutcome;
}): Promise<string | undefined> {
  const FAST_TEST_RETRY_INTERVAL_MS = 8;
  const isFast = process.env.OPENCLAW_TEST_FAST === "1";
  return await readLatestSubagentOutputWithRetryUsing({
    sessionKey: params.sessionKey,
    maxWaitMs: params.maxWaitMs,
    outcome: params.outcome,
    retryIntervalMs: isFast ? FAST_TEST_RETRY_INTERVAL_MS : 100,
    readSubagentOutput,
  });
}

/**
 * Enhanced: uses the enhanced readSubagentOutput.
 */
export async function captureSubagentCompletionReply(
  sessionKey: string,
  options?: { waitForReply?: boolean; outcome?: SubagentRunOutcome; sessionFile?: string },
): Promise<string | undefined> {
  const FAST_TEST_RETRY_INTERVAL_MS = 8;
  const isFast = process.env.OPENCLAW_TEST_FAST === "1";
  return await captureSubagentCompletionReplyUsing({
    sessionKey,
    waitForReply: options?.waitForReply,
    maxWaitMs: isFast ? 50 : 1_500,
    retryIntervalMs: isFast ? FAST_TEST_RETRY_INTERVAL_MS : 100,
    readSubagentOutput: async (nextSessionKey) =>
      await readSubagentOutput(nextSessionKey, options?.outcome, {
        sessionFile: options?.sessionFile,
      }),
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
export const testing = {
  setDepsForTest(overrides?: Partial<EnhancedAnnounceOutputDeps>) {
    enhancedDeps = overrides
      ? {
          ...defaultEnhancedDeps,
          ...overrides,
        }
      : defaultEnhancedDeps;
  },
  // Expose enhanced internal helpers for testing
  summarizeSubagentOutputHistory,
  selectSubagentOutputText,
  readSubagentOutput,
};
