/**
 * Tests for the enhanced subagent-initial-user-message wrapper.
 *
 * Covers the "## Task" Markdown format and backward-compatible
 * behaviour with the upstream function signature.
 */
import { describe, expect, it } from "vitest";
import { buildSubagentInitialUserMessage } from "./subagent-initial-user-message.enhanced.js";

describe("buildSubagentInitialUserMessage (enhanced)", () => {
  it("uses ## Task Markdown heading for the task", () => {
    const msg = buildSubagentInitialUserMessage({
      childDepth: 1,
      maxSpawnDepth: 3,
      persistentSession: false,
      task: "UNIQUE_VISIBLE_TASK\n  preserve indentation",
    });

    expect(msg).toContain("## Task");
    expect(msg).toContain("UNIQUE_VISIBLE_TASK");
    expect(msg).toContain("  preserve indentation");
    // The enhanced format should NOT use the upstream "[Subagent Task]" format
    expect(msg).not.toContain("[Subagent Task]");
    expect(msg).toContain("depth 1/3");
  });

  it("includes the persistent session note when requested", () => {
    const msg = buildSubagentInitialUserMessage({
      childDepth: 2,
      maxSpawnDepth: 4,
      persistentSession: true,
      task: "continue the task",
    });

    expect(msg).toContain("persistent and remains available");
  });

  it("uses newline separator (not double newlines like upstream)", () => {
    const msg = buildSubagentInitialUserMessage({
      childDepth: 1,
      maxSpawnDepth: 2,
      persistentSession: false,
      task: "hello world",
    });

    // The message uses \n as separator, so sections are separated by a single
    // blank line (\n\n). The upstream format used \n\n as separator, resulting
    // in double blank lines between sections. The enhanced format produces
    // cleaner output.
    expect(msg).toContain("## Task\nhello world");
    expect(msg).toContain("Begin. Execute the task above to completion.");
  });

  it("handles empty task gracefully", () => {
    const msg = buildSubagentInitialUserMessage({
      childDepth: 1,
      maxSpawnDepth: 2,
      persistentSession: false,
      task: "",
    });

    expect(msg).toContain("[Subagent Context]");
    expect(msg).not.toContain("## Task");
    expect(msg).toContain("Begin. Execute the task above to completion.");
  });

  it("handles whitespace-only task gracefully", () => {
    const msg = buildSubagentInitialUserMessage({
      childDepth: 1,
      maxSpawnDepth: 2,
      persistentSession: false,
      task: "   ",
    });

    expect(msg).not.toContain("## Task");
    expect(msg).toContain("Begin. Execute the task above to completion.");
  });

  it("handles undefined task gracefully", () => {
    const msg = buildSubagentInitialUserMessage({
      childDepth: 1,
      maxSpawnDepth: 2,
      persistentSession: false,
    });

    expect(msg).not.toContain("## Task");
    expect(msg).toContain("Begin. Execute the task above to completion.");
  });

  it("says 'task above' instead of 'assigned task'", () => {
    const msg = buildSubagentInitialUserMessage({
      childDepth: 1,
      maxSpawnDepth: 2,
      persistentSession: false,
      task: "do something",
    });

    expect(msg).toContain("Execute the task above to completion.");
    expect(msg).not.toContain("Execute the assigned task to completion.");
  });
});
