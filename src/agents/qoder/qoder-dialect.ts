import type { CliBackendConfig } from "../../config/types.js";
import type { CliOutput, CliStreamingDelta, CliUsage } from "../cli-runner/cli-backend-types.js";
import { getCliBackendParser } from "../cli-runner/jsonl-parser.js";
import "../cli-runner/parsers/qodercli-parser.js";

export type CliDialectApplyResult = {
  handled: boolean;
  sessionId?: string;
  usage?: CliUsage;
  output?: CliOutput;
};

export function applyCliDialectEvent(params: {
  line: string;
  backend: CliBackendConfig;
  providerId: string;
  sessionId?: string;
  usage?: CliUsage;
  texts: string[];
  onAssistantDelta?: (delta: CliStreamingDelta) => void;
}): CliDialectApplyResult {
  const parser = getCliBackendParser(params.providerId, params.backend);
  if (!parser) {
    return { handled: false, sessionId: params.sessionId, usage: params.usage };
  }

  const event = parser.parseLine(params.line, {
    backend: params.backend,
    providerId: params.providerId,
    sessionId: params.sessionId,
    usage: params.usage,
    textSoFar: params.texts.join("\n"),
  });
  if (!event) {
    return { handled: false, sessionId: params.sessionId, usage: params.usage };
  }

  const sessionId = event.sessionId ?? params.sessionId;
  const usage = event.usage ?? params.usage;
  const text = event.text?.trim();
  if (text) {
    params.texts.push(text);
    const delta = event.delta ?? event.text ?? "";
    if (delta && params.onAssistantDelta) {
      const cumulative = params.texts.join("\n").trim();
      params.onAssistantDelta({ text: cumulative, delta, sessionId, usage });
    }
  }

  const output = event.final
    ? { text: params.texts.join("\n").trim(), sessionId, usage }
    : undefined;
  return { handled: true, sessionId, usage, output };
}
