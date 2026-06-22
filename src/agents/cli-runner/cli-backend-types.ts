import type { CliBackendConfig } from "../../config/types.js";
import type {
  MessagingToolSend,
  MessagingToolSourceReplyPayload,
} from "../embedded-agent-messaging.types.js";

export type CliUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

export type CliOutput = {
  text: string;
  rawText?: string;
  sessionId?: string;
  usage?: CliUsage;
  errorText?: string;
  diagnostics?: {
    process?: CliProcessDiagnostics;
  };
  finalPromptText?: string;
  didSendViaMessagingTool?: boolean;
  didDeliverSourceReplyViaMessageTool?: boolean;
  messagingToolSentTexts?: string[];
  messagingToolSentMediaUrls?: string[];
  messagingToolSentTargets?: MessagingToolSend[];
  messagingToolSourceReplyPayloads?: MessagingToolSourceReplyPayload[];
  yielded?: true;
};

type CliProcessDiagnostics = {
  backendId: string;
  processReason: string;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  durationMs: number;
  stdoutBytes: number;
  stdoutHash: string;
  stderrBytes: number;
  stderrHash: string;
  useResume: boolean;
};

export type CliStreamingDelta = {
  text: string;
  delta: string;
  sessionId?: string;
  usage?: CliUsage;
};

export type ParsedCliJsonlEvent = {
  /** Text to append to the aggregate JSONL output. */
  text?: string;
  /** Delta to surface to live streaming consumers. Defaults to text when omitted. */
  delta?: string;
  /** Marks this event as a final output record. */
  final?: boolean;
  sessionId?: string;
  usage?: CliUsage;
};

export type CliBackendParserContext = {
  backend: CliBackendConfig;
  providerId: string;
  sessionId?: string;
  usage?: CliUsage;
  textSoFar: string;
};

export interface CliBackendParser {
  /** Stable parser/dialect id, referenced by CliBackendConfig.jsonlDialect. */
  id: string;
  parseLine(line: string, context: CliBackendParserContext): ParsedCliJsonlEvent | null;
}
