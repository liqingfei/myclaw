import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOperationalRunInstanceRef,
  prepareAgentRunAdmission,
} from "../../agents/admitted-run-context.js";
import { createDeferredEmbeddedRunLifecycleManager } from "../../agents/embedded-agent-runner/run/deferred-lifecycle-owner.js";
import { isEmbeddedAgentRunHandleActive } from "../../agents/embedded-agent-runner/runs.js";
import { withPreparedEmbeddedRunToolAuthority } from "../../agents/harness/tool-authority.runtime.js";
import {
  getPreparedModelRuntimeBorrowedSnapshot,
  getPreparedModelRuntimePluginGeneration,
} from "../../agents/prepared-model-runtime-generation-scope.js";
import { getGatewayToolCallerIdentity } from "../../agents/tools/gateway-caller-context.js";
import {
  getCliHistoryWriter,
  runWithCliHistoryWriter,
} from "../../config/sessions/cli-history-boundary.js";
import {
  assertOwnedTranscriptWriteCommit,
  getOwnedSessionTranscriptWriterFence,
  withOwnedSessionTranscriptWrites,
} from "../../config/sessions/transcript-write-context.js";
import { startAgentRunExecution } from "./agent-run-execution-phase.js";

const dispatchAgentRunFromGateway = vi.hoisted(() => vi.fn());

vi.mock("./agent-run-dispatch.js", () => ({
  dispatchAgentRunFromGateway,
  resolveAbortedAgentStopReason: () => "rpc",
}));

function createExecution(options: { aborted?: boolean; assertContextCurrent?: () => void } = {}) {
  const abortCleanup = vi.fn();
  const gatewayRelease = vi.fn();
  let resolveRuntimeReleased!: () => void;
  const runtimeReleased = new Promise<void>((resolve) => {
    resolveRuntimeReleased = resolve;
  });
  const runtimeRelease = vi.fn(resolveRuntimeReleased);
  const controller = new AbortController();
  if (options.aborted) {
    controller.abort();
  }
  return {
    abortCleanup,
    gatewayRelease,
    runtimeRelease,
    runtimeReleased,
    params: {
      assertContextCurrent: options.assertContextCurrent,
      prepared: {
        activeGatewayWorkAdmission: {
          release: gatewayRelease,
          run: async (run: () => Promise<void>) => await run(),
        },
        activeRunAbort: {
          cleanup: abortCleanup,
          controller,
          registered: false,
        },
        dispatchTaskTrackingMode: "none",
        effectiveAllowModelOverride: false,
        lifecycleStorePath: "",
        operationalRunInstance: {},
        preparedModelRuntimeLease: { release: runtimeRelease, snapshot: {} },
        replyDispatchRuntime: {
          config: { runtime: "A" },
          pluginGeneration: "generation-A",
        },
        unpersistedOffloadedRefs: [],
        userTurn: {
          execApprovalFollowupHandoffClaimId: "claim",
          message: "continue",
          senderIsOwner: false,
          suppressPromptPersistence: false,
        },
        workspaceOverride: "/workspace/A",
      },
      request: {},
      cfg: {},
      activeSessionAgentId: "main",
      delivery: {},
      isNewSession: false,
      isRawModelRun: true,
      isOneShotModelRun: true,
      isRestartRecoveryResumeRun: false,
      suppressVisibleSessionEffects: true,
      images: [],
      imageOrder: [],
      media: [],
      runId: "owner-test",
      agentDedupeKeys: [],
      bestEffortDeliver: false,
      lifecycleGeneration: "test",
      preserveUserFacingSessionModelState: false,
      skipAgentInitialSessionTouch: true,
      canUseInternalRuntimeHandoff: false,
      client: null,
      context: {
        dedupe: new Map(),
        deps: {},
        logGateway: { error: vi.fn(), warn: vi.fn() },
      },
      io: {
        emitAcceptance: vi.fn(),
        emitFinal: vi.fn(),
      },
      releaseCronContinuationClaimWithRecovery: async () => true,
    } as unknown as Parameters<typeof startAgentRunExecution>[0],
  };
}

describe("startAgentRunExecution Gateway ownership", () => {
  beforeEach(() => dispatchAgentRunFromGateway.mockReset());

  it.each(["success", "failure", "aborted"] as const)(
    "isolates accepted child execution and %s settlement from its parent",
    async (outcome) => {
      const execution = createExecution({ aborted: outcome === "aborted" });
      const parent = {
        agentId: "main",
        sessionId: "parent-session",
        sessionKey: "agent:main:parent",
        sessionFile: "/tmp/parent-session.jsonl",
        runId: "parent-run",
        workspaceDir: "/tmp/parent-workspace",
        config: {},
        provider: "openai",
        modelId: "gpt-test",
      };
      const target = { ...parent, storePath: "/tmp/parent-agent.sqlite" };
      const child = {
        agentId: "main",
        sessionId: "child-session",
        sessionKey: "agent:main:subagent:child",
        sessionFile: "/tmp/child-session.jsonl",
        runId: execution.params.runId,
      };
      const admission = prepareAgentRunAdmission({
        cfg: {},
        operationalRunInstance: createOperationalRunInstanceRef(parent.runId),
        facts: {
          agentId: parent.agentId,
          runId: parent.runId,
          ingress: { kind: "system", state: "present", boundary: "child-execution-test" },
        },
      });
      const historyWriter = {
        target,
        runId: parent.runId,
        authFingerprint: "parent-auth",
        assertCurrent: () => {},
        assertReadable: () => {},
      };
      const observations: unknown[] = [];
      const observe = () => {
        observations.push({
          caller: getGatewayToolCallerIdentity(),
          writer: getOwnedSessionTranscriptWriterFence(),
          history: getCliHistoryWriter(target),
        });
      };
      execution.abortCleanup.mockImplementation(observe);
      let childRegistered = false;
      dispatchAgentRunFromGateway.mockImplementationOnce(async (dispatch) => {
        const lifecycle = createDeferredEmbeddedRunLifecycleManager(child);
        try {
          // This is the early CLI handoff, before the child's runtime admission.
          lifecycle.handoffToCli();
          childRegistered = isEmbeddedAgentRunHandleActive(child.sessionId);
          assertOwnedTranscriptWriteCommit({ ...child, storePath: "/tmp/child-agent.sqlite" });
          await Promise.resolve();
          observe();
          expect(dispatch.ingressOpts.operationalRunInstance).toBe(
            execution.params.prepared.operationalRunInstance,
          );
          if (outcome === "failure") {
            throw new Error("child execution failed");
          }
        } finally {
          await lifecycle.complete();
          dispatch.cleanupAbortController();
        }
      });
      try {
        const admittedRunContext = await admission.admit("embedded", "parent-test");
        await withPreparedEmbeddedRunToolAuthority(
          { admittedRunContext },
          parent,
          undefined,
          async () =>
            withOwnedSessionTranscriptWrites(
              {
                sessionTarget: { ...target, expectedWriterRunId: parent.runId },
                assertCommitAllowed: () => {},
                withTranscriptWrite: async (run) => await run(),
              },
              async () =>
                runWithCliHistoryWriter(historyWriter, async () => {
                  const parentCaller = getGatewayToolCallerIdentity();
                  await startAgentRunExecution(execution.params);
                  expect(getGatewayToolCallerIdentity()).toBe(parentCaller);
                  expect(getOwnedSessionTranscriptWriterFence()?.expectedWriterRunId).toBe(
                    parent.runId,
                  );
                  expect(getCliHistoryWriter(target)).toBe(historyWriter);
                }),
            ),
        );
        expect(childRegistered).toBe(outcome !== "aborted");
        expect(isEmbeddedAgentRunHandleActive(child.sessionId)).toBe(false);
        expect(observations).toHaveLength(outcome === "aborted" ? 1 : 2);
        for (const observation of observations) {
          expect(observation).toEqual({ caller: undefined, writer: undefined, history: undefined });
        }
        if (outcome === "success") {
          expect(execution.params.io.emitFinal).not.toHaveBeenCalled();
        } else {
          expect(execution.params.io.emitFinal).toHaveBeenCalledWith(
            expect.arrayContaining([
              expect.objectContaining({
                status: outcome === "aborted" ? "timeout" : "error",
                summary: outcome === "aborted" ? "aborted" : "child execution failed",
              }),
            ]),
            expect.anything(),
          );
        }
      } finally {
        admission.close();
      }
    },
  );

  it("dispatches with the runtime generation frozen at admission", async () => {
    const execution = createExecution();
    let resolveDispatched!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      resolveDispatched = resolve;
    });
    let resolveCleanupObserved!: () => void;
    const cleanupObserved = new Promise<void>((resolve) => {
      resolveCleanupObserved = resolve;
    });
    let borrowedAfterCleanup: Promise<unknown> | undefined;
    let dispatchedGeneration: unknown;
    let dispatchedSnapshot: unknown;
    dispatchAgentRunFromGateway.mockImplementationOnce(() => {
      const generation = execution.params.prepared.replyDispatchRuntime.pluginGeneration;
      dispatchedGeneration = getPreparedModelRuntimePluginGeneration();
      dispatchedSnapshot = getPreparedModelRuntimeBorrowedSnapshot(generation);
      borrowedAfterCleanup = (async () => {
        await cleanupObserved;
        return getPreparedModelRuntimeBorrowedSnapshot(generation);
      })();
      resolveDispatched();
    });

    const completion = startAgentRunExecution(execution.params);

    await dispatched;
    expect(dispatchedGeneration).toBe(
      execution.params.prepared.replyDispatchRuntime.pluginGeneration,
    );
    expect(dispatchedSnapshot).toBe(execution.params.prepared.preparedModelRuntimeLease.snapshot);
    const dispatch = dispatchAgentRunFromGateway.mock.calls[0]?.[0];
    expect(dispatch?.commandRuntimeContext).toEqual({
      config: { runtime: "A" },
      pluginGeneration: "generation-A",
    });
    expect(dispatch?.ingressOpts.workspaceDir).toBe("/workspace/A");
    expect(execution.runtimeRelease).not.toHaveBeenCalled();

    dispatch?.cleanupAbortController();
    dispatch?.cleanupAbortController();
    resolveCleanupObserved();
    await expect(borrowedAfterCleanup).resolves.toBeUndefined();
    expect(execution.runtimeRelease).toHaveBeenCalledOnce();
    await completion;
  });

  it("releases the admitted runtime once when aborted before dispatch", async () => {
    const execution = createExecution({ aborted: true });

    await startAgentRunExecution(execution.params);
    expect(dispatchAgentRunFromGateway).not.toHaveBeenCalled();
    expect(execution.abortCleanup).toHaveBeenCalledOnce();
    expect(execution.gatewayRelease).toHaveBeenCalledOnce();
    expect(execution.runtimeRelease).toHaveBeenCalledOnce();
  });

  it("releases the admitted runtime once when its owner retires before dispatch", async () => {
    const execution = createExecution({
      assertContextCurrent: () => {
        throw new Error("Gateway owner retired");
      },
    });

    await startAgentRunExecution(execution.params);
    expect(dispatchAgentRunFromGateway).not.toHaveBeenCalled();
    expect(execution.abortCleanup).toHaveBeenCalledOnce();
    expect(execution.gatewayRelease).toHaveBeenCalledOnce();
    expect(execution.runtimeRelease).toHaveBeenCalledOnce();
  });
});
