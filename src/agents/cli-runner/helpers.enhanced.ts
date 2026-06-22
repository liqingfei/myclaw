/**
 * Enhanced CLI runner helpers with promptArgPrefix support.
 *
 * This is a wrapper around helpers.ts that adds promptArgPrefix handling
 * without modifying the upstream file.
 */

// Re-export everything from upstream
export * from "./helpers.js";

import type { CliBackendConfig } from "../../config/types.js";
import { buildCliArgs as _upstreamBuildCliArgs } from "./helpers.js";

/**
 * Build CLI arguments with promptArgPrefix support.
 *
 * When a backend defines promptArgPrefix (e.g., "-p" for qodercli),
 * the prompt is passed as: <prefix> <prompt> instead of just <prompt>.
 * This is skipped when the args already contain a {prompt} placeholder.
 */
export function buildCliArgs(params: {
  backend: CliBackendConfig;
  baseArgs: string[];
  modelId: string;
  sessionId?: string;
  systemPrompt?: string | null;
  systemPromptFilePath?: string;
  imagePaths?: string[];
  promptArg?: string;
  useResume: boolean;
}): string[] {
  if (
    params.backend.promptArgPrefix &&
    params.promptArg !== undefined &&
    !params.baseArgs.some((arg) => arg === "{prompt}")
  ) {
    // Let upstream handle everything, then fix up the prompt to include its prefix.
    // The upstream pushes the prompt as a positional arg before image paths.
    const args = _upstreamBuildCliArgs(params);
    // Find the prompt arg from the end (image paths are filesystem paths, never
    // equal to the prompt text) and insert the prefix before it.
    const promptIdx = args.lastIndexOf(params.promptArg);
    if (promptIdx >= 0) {
      args.splice(promptIdx, 0, params.backend.promptArgPrefix);
    }
    return args;
  }

  // Fall through to upstream for placeholder replacement and non-prefix cases
  return _upstreamBuildCliArgs(params);
}
