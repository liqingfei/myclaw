import type { CliBackendConfig } from "../../config/types.js";
import type { CliBackendParser } from "./cli-backend-types.js";

const cliBackendParsers = new Map<string, CliBackendParser>();
const backendParserAliases = new Map<string, string>();

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

export function registerCliBackendParser(parser: CliBackendParser): void {
  const id = normalizeId(parser.id);
  if (!id) {
    throw new Error("CLI backend parser id must be non-empty");
  }
  cliBackendParsers.set(id, parser);
}

export function registerCliBackendParserAlias(backendId: string, parserId: string): void {
  const normalizedBackendId = normalizeId(backendId);
  const normalizedParserId = normalizeId(parserId);
  if (!normalizedBackendId || !normalizedParserId) {
    throw new Error("CLI backend parser aliases require non-empty backend and parser ids");
  }
  backendParserAliases.set(normalizedBackendId, normalizedParserId);
}

export function getCliBackendParser(
  backendId: string,
  backend?: Pick<CliBackendConfig, "jsonlDialect">,
): CliBackendParser | undefined {
  const dialect = backend?.jsonlDialect?.trim();
  if (dialect) {
    return cliBackendParsers.get(normalizeId(dialect));
  }
  const aliased = backendParserAliases.get(normalizeId(backendId));
  return aliased ? cliBackendParsers.get(aliased) : undefined;
}

export function clearCliBackendParsersForTest(): void {
  cliBackendParsers.clear();
  backendParserAliases.clear();
}
