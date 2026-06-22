import { isRecord } from "../../../utils.js";
import type {
  CliBackendParser,
  CliBackendParserContext,
  ParsedCliJsonlEvent,
} from "../cli-backend-types.js";
import { registerCliBackendParser, registerCliBackendParserAlias } from "../jsonl-parser.js";

function collectText(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => collectText(entry)).join("");
  }
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  if (Array.isArray(value.content)) {
    return value.content.map((entry) => collectText(entry)).join("");
  }
  if (isRecord(value.message)) {
    return collectText(value.message);
  }
  return "";
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pickSessionId(parsed: Record<string, unknown>): string | undefined {
  const candidates = [parsed.session_id, parsed.sessionId];
  if (isRecord(parsed.message)) {
    candidates.push(parsed.message.session_id, parsed.message.sessionId);
  }
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseUsage(raw: unknown): ParsedCliJsonlEvent["usage"] {
  if (!isRecord(raw)) {
    return undefined;
  }
  const pick = (key: string) =>
    typeof raw[key] === "number" && raw[key] > 0 ? raw[key] : undefined;
  const usage = {
    input: pick("input_tokens") ?? pick("inputTokens") ?? pick("input"),
    output: pick("output_tokens") ?? pick("outputTokens") ?? pick("output"),
    cacheRead: pick("cache_read_input_tokens") ?? pick("cached_input_tokens") ?? pick("cacheRead"),
    cacheWrite:
      pick("cache_creation_input_tokens") ?? pick("cache_write_input_tokens") ?? pick("cacheWrite"),
    total: pick("total_tokens") ?? pick("total"),
  };
  return usage.input || usage.output || usage.cacheRead || usage.cacheWrite || usage.total
    ? usage
    : undefined;
}

export const qoderCliParser: CliBackendParser = {
  id: "qoder-stream-json",
  parseLine(line: string, _context: CliBackendParserContext): ParsedCliJsonlEvent | null {
    const parsed = parseJsonLine(line);
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }

    const usage = parseUsage(parsed.usage);
    const sessionId = pickSessionId(parsed);
    const type = parsed.type.toLowerCase();

    if (type === "system" || type === "session") {
      return sessionId || usage ? { sessionId, usage } : null;
    }

    if (type !== "assistant" && type !== "result") {
      return sessionId || usage ? { sessionId, usage } : null;
    }

    const text = collectText(parsed.message).trim();
    if (!text) {
      return sessionId || usage ? { sessionId, usage, final: type === "result" } : null;
    }

    return {
      text,
      delta: text,
      final: type === "result" && parsed.done === true,
      sessionId,
      usage,
    };
  },
};

export function registerQoderCliParser(): void {
  registerCliBackendParser(qoderCliParser);
  registerCliBackendParserAlias("qodercli", qoderCliParser.id);
  registerCliBackendParserAlias("qoder", qoderCliParser.id);
}

registerQoderCliParser();
