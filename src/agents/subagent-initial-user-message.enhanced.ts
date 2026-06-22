/**
 * Enhanced wrapper for subagent-initial-user-message.ts.
 *
 * Overrides buildSubagentInitialUserMessage to use "## Task" Markdown
 * format instead of the upstream "[Subagent Task]" format. This ensures
 * the task text is reliably parsed as the primary task by CLI-backend
 * subagents (e.g. qodercli) which may not introspect the system prompt.
 *
 * The upstream file is kept at zero modifications to eliminate rebase
 * conflicts. When rebasing, only this file may need attention if the
 * upstream function signature or behaviour changes.
 */
export function buildSubagentInitialUserMessage(params: {
  childDepth: number;
  maxSpawnDepth: number;
  /** When true, this subagent uses a persistent session for follow-up messages. */
  persistentSession: boolean;
  /** Task text to include directly in the message. */
  task?: string;
}): string {
  const lines = [
    `[Subagent Context] You are running as a subagent (depth ${params.childDepth}/${params.maxSpawnDepth}). Results auto-announce to your requester; do not busy-poll for status.`,
  ];
  if (params.persistentSession) {
    lines.push(
      "[Subagent Context] This subagent session is persistent and remains available for thread follow-up messages.",
    );
  }
  if (params.task && params.task.trim()) {
    lines.push("", "## Task", params.task.trim());
  }
  lines.push("", "Begin. Execute the task above to completion.");
  return lines.join("\n");
}
