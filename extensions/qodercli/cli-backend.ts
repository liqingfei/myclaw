import type {
  CliBackendJsonlUsage,
  CliBackendParseJsonlEvent,
  CliBackendParsedJsonlEvent,
  CliBackendPlugin,
} from "openclaw/plugin-sdk/cli-backend";
import {
  asOptionalRecord,
  isRecord,
  normalizeOptionalString,
} from "openclaw/plugin-sdk/string-coerce-runtime";

function collectQoderText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => collectQoderText(entry)).join("");
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
    return value.content.map((entry) => collectQoderText(entry)).join("");
  }
  return collectQoderText(value.message);
}

function readQoderSessionId(value: Record<string, unknown>): string | undefined {
  const message = asOptionalRecord(value.message);
  for (const candidate of [
    value.session_id,
    value.sessionId,
    message?.session_id,
    message?.sessionId,
  ]) {
    const sessionId = normalizeOptionalString(candidate);
    if (sessionId) {
      return sessionId;
    }
  }
  return undefined;
}

function readQoderUsage(value: unknown): CliBackendJsonlUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const positiveNumber = (key: string) => {
    const candidate = value[key];
    return typeof candidate === "number" && candidate > 0 ? candidate : undefined;
  };
  const usage = {
    input:
      positiveNumber("input_tokens") ?? positiveNumber("inputTokens") ?? positiveNumber("input"),
    output:
      positiveNumber("output_tokens") ?? positiveNumber("outputTokens") ?? positiveNumber("output"),
    cacheRead:
      positiveNumber("cache_read_input_tokens") ??
      positiveNumber("cached_input_tokens") ??
      positiveNumber("cacheRead"),
    cacheWrite:
      positiveNumber("cache_creation_input_tokens") ??
      positiveNumber("cache_write_input_tokens") ??
      positiveNumber("cacheWrite"),
    total: positiveNumber("total_tokens") ?? positiveNumber("total"),
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

const parseQoderCliJsonlEvent: CliBackendParseJsonlEvent = (line) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  const type = parsed.type.toLowerCase();
  const sessionId = readQoderSessionId(parsed);
  const sessionEvent: CliBackendParsedJsonlEvent[] = sessionId
    ? [{ kind: "sessionId", sessionId }]
    : [];
  if (type === "system" || type === "session") {
    return sessionEvent.length > 0 ? sessionEvent : null;
  }
  if (type !== "assistant" && type !== "result") {
    return sessionEvent.length > 0 ? sessionEvent : null;
  }

  const text = collectQoderText(parsed.message).trim();
  if (type !== "result" || parsed.done !== true) {
    return text ? [...sessionEvent, { kind: "text", text }] : sessionEvent;
  }

  const events: CliBackendParsedJsonlEvent[] = [...sessionEvent];
  if (text) {
    events.push({ kind: "text", text: `\n${text}` });
  }
  events.push({ kind: "result", usage: readQoderUsage(parsed.usage) });
  return events;
};

function resolveQoderCommand(pluginConfig: unknown): string {
  const config = asOptionalRecord(pluginConfig);
  const cliBackend = asOptionalRecord(config?.cliBackend);
  return normalizeOptionalString(cliBackend?.command) ?? "qodercli";
}

export function buildQoderCliBackend(pluginConfig?: unknown): CliBackendPlugin {
  return {
    id: "qoder",
    modelProvider: "qoder",
    config: {
      command: resolveQoderCommand(pluginConfig),
      args: ["-p", "-o", "stream-json", "{prompt}"],
      resumeArgs: ["-p", "-o", "stream-json", "-r", "{sessionId}", "{prompt}"],
      output: "jsonl",
      resumeOutput: "jsonl",
      input: "arg",
      modelArg: "-m",
      sessionMode: "existing",
      sessionIdFields: ["session_id", "sessionId", "message.session_id", "message.sessionId"],
      systemPromptArg: "--append-system-prompt",
      systemPromptMode: "append",
      serialize: true,
    },
    parseJsonlEvent: parseQoderCliJsonlEvent,
  };
}
