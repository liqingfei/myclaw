/**
 * Enhanced CLI output parser with dialect hooks for pluggable JSONL backends.
 *
 * This is a wrapper around cli-output.ts that adds dialect-aware parsing
 * (e.g., qodercli stream-json format) without modifying the upstream file.
 *
 * When a backend uses a registered jsonlDialect (e.g., "qoder-stream-json"),
 * dialect lines are intercepted and handled by the dialect parser before the
 * standard JSONL parser ever sees them. For non-dialect backends, this wrapper
 * is transparent and passes everything through to the upstream.
 */

// Re-export everything from upstream
export * from "./cli-output.js";

import type { CliBackendConfig } from "../config/types.js";
import {
  createCliJsonlStreamingParser as _upstreamStreaming,
  parseCliJsonl as _upstreamParse,
  type CliOutput,
  type CliStreamingDelta,
} from "./cli-output.js";
import type { CliUsage } from "./cli-runner/cli-backend-types.js";
import { applyCliDialectEvent } from "./qoder/qoder-dialect.js";

/**
 * Creates a stateful parser for streaming JSONL CLI backend output
 * with dialect-aware preprocessing.
 *
 * For backends with a registered jsonlDialect (e.g., "qoder-stream-json"),
 * each line is first tried against the dialect parser. If the dialect handles
 * the line, it is consumed and the standard parser never sees it. For
 * non-dialect backends, all lines pass through to the upstream parser.
 */
export function createCliJsonlStreamingParser(params: {
  backend: CliBackendConfig;
  providerId: string;
  onAssistantDelta: (delta: CliStreamingDelta) => void;
  onToolUseStart?: (delta: import("./cli-output.js").CliToolUseStartDelta) => void;
  onToolResult?: (delta: import("./cli-output.js").CliToolResultDelta) => void;
  onCommentaryText?: (text: string) => void;
}) {
  const upstream = _upstreamStreaming(params);

  // Dialect state (mirrors the upstream's internal state for dialect-handled lines)
  let sessionId: string | undefined;
  let usage: CliUsage | undefined;
  let output: CliOutput | null = null;
  const texts: string[] = [];
  let lineBuffer = "";

  /**
   * Try to handle a single line through the dialect parser.
   * Returns true if the line was handled (should be skipped by upstream).
   */
  const processDialectLine = (line: string): boolean => {
    const result = applyCliDialectEvent({
      line,
      backend: params.backend,
      providerId: params.providerId,
      sessionId,
      usage,
      texts,
      onAssistantDelta: params.onAssistantDelta,
    });
    sessionId = result.sessionId;
    usage = result.usage;
    output = result.output ?? output;
    return result.handled;
  };

  return {
    push(chunk: string) {
      if (!chunk) {
        return;
      }
      lineBuffer += chunk;

      // Collect lines that the dialect does NOT handle
      let remaining = "";
      while (true) {
        const newlineIndex = lineBuffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        if (!processDialectLine(line)) {
          remaining += line + "\n";
        }
      }

      if (remaining) {
        upstream.push(remaining);
      }
    },

    finish() {
      // Process any remaining buffer through dialect
      const tail = lineBuffer.trim();
      lineBuffer = "";
      if (tail) {
        processDialectLine(tail);
      }
      upstream.finish();
    },

    getOutput() {
      // Dialect output takes precedence over upstream output
      if (output) {
        return output;
      }
      return upstream.getOutput();
    },

    getErrorText() {
      return upstream.getErrorText();
    },
  };
}

/**
 * Parses complete JSONL output from a CLI backend into normalized text and metadata,
 * with dialect-aware preprocessing.
 *
 * For backends with a registered jsonlDialect, each line is first tried against
 * the dialect parser. Dialect-handled lines are consumed and the standard parser
 * never sees them.
 */
export function parseCliJsonl(
  raw: string,
  backend: CliBackendConfig,
  providerId: string,
): CliOutput | null {
  let sessionId: string | undefined;
  let usage: CliUsage | undefined;
  const texts: string[] = [];
  const dialectLines: string[] = [];
  const nonDialectLines: string[] = [];

  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const result = applyCliDialectEvent({
      line: trimmed,
      backend,
      providerId,
      sessionId,
      usage,
      texts,
    });
    sessionId = result.sessionId;
    usage = result.usage;

    if (result.output) {
      return result.output;
    }
    if (result.handled) {
      dialectLines.push(trimmed);
      continue;
    }
    nonDialectLines.push(trimmed);
  }

  // If all lines were handled by dialect, build output from collected texts
  if (dialectLines.length > 0 && nonDialectLines.length === 0) {
    const text = texts.join("\n").trim();
    return text ? { text, sessionId, usage } : null;
  }

  // If no lines were handled by dialect, pass everything to upstream
  if (dialectLines.length === 0) {
    return _upstreamParse(raw, backend, providerId);
  }

  // Mixed: pass non-dialect lines to upstream, then merge results
  const upstreamResult =
    nonDialectLines.length > 0
      ? _upstreamParse(nonDialectLines.join("\n"), backend, providerId)
      : null;

  const dialectText = texts.join("\n").trim();
  if (dialectText && upstreamResult?.text) {
    return {
      text: [dialectText, upstreamResult.text].filter(Boolean).join("\n"),
      sessionId: upstreamResult.sessionId ?? sessionId,
      usage: upstreamResult.usage ?? usage,
    };
  }
  if (upstreamResult) {
    return upstreamResult;
  }
  return dialectText ? { text: dialectText, sessionId, usage } : null;
}
