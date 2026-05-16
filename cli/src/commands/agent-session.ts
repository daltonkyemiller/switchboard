import { Result } from "@praha/byethrow";
import { attachAgentSession } from "./attach.ts";
import { createAgentSession } from "./new.ts";
import { connect } from "../shared/client.ts";
import { lastAgentForCwd, rememberLastAgent } from "../shared/last-agent.ts";
import { fail, fromTmux, type CliResultAsync } from "../shared/result.ts";
import type { AgentState, Tool } from "../shared/state.ts";
import { agentTmux, tmux } from "../shared/tmux.ts";
import { paneWindow, viewerPaneForSessionInWindow } from "../shared/tmux-pane.ts";

export async function loadAgents(): Promise<readonly AgentState[]> {
  const client = await connect();
  const response = await client.request("state.list", {});
  client.close();

  if ("error" in response) {
    throw new Error(response.error.message);
  }

  const result = response.result as { agents?: readonly AgentState[] };
  return result.agents ?? [];
}

async function sessionExists(session: string): Promise<boolean> {
  return (await agentTmux(["has-session", "-t", session])).ok;
}

export async function activeSessionForCwd(cwd: string): CliResultAsync<string> {
  const session = await lastAgentForCwd(cwd);
  if (session && await sessionExists(session)) return Result.succeed(session);

  const agents = await loadAgents();
  const [fallback] = agents
    .filter((agent) => agent.cwd === cwd)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (fallback && await sessionExists(fallback.session)) return Result.succeed(fallback.session);

  if (session) return fail(`active agent no longer exists: ${session}`);
  return fail(`no active agent for ${cwd}`);
}

export async function sendTextToAgentSession(
  session: string,
  text: string,
  options: { readonly submit: boolean },
): CliResultAsync<void> {
  const exists = await agentTmux(["has-session", "-t", session]);
  if (!exists.ok) return fail(`session not found: ${session}`);

  const bufferName = `switchboard-send-${process.pid}`;
  const buffer = fromTmux(await agentTmux(["set-buffer", "-b", bufferName, "--", text]), "failed to stage text");
  if (Result.isFailure(buffer)) return buffer;

  const pasted = fromTmux(
    await agentTmux(["paste-buffer", "-d", "-b", bufferName, "-t", session]),
    "failed to send text",
  );
  if (Result.isFailure(pasted)) return pasted;

  if (options.submit) {
    const submitted = fromTmux(await agentTmux(["send-keys", "-t", session, "Enter"]), "failed to submit text");
    if (Result.isFailure(submitted)) return submitted;
  }

  return Result.succeed(undefined);
}

export async function attachOrFocusAgentSession(options: {
  readonly session: string;
  readonly targetPane: string | null;
}): CliResultAsync<void> {
  if (!process.env["TMUX"]) return Result.succeed(undefined);

  if (options.targetPane) {
    const windowId = await paneWindow(options.targetPane);
    const viewer = windowId ? await viewerPaneForSessionInWindow(windowId, options.session) : "";
    if (viewer) {
      const selected = fromTmux(await tmux(["select-pane", "-t", viewer]), "failed to focus agent");
      if (Result.isFailure(selected)) return selected;
      return Result.succeed(undefined);
    }
  }

  const attached = await attachAgentSession({
    target: options.session,
    targetPane: options.targetPane ?? undefined,
  });
  if (Result.isFailure(attached)) return fail(attached.error.message, attached.error.cause);
  return Result.succeed(undefined);
}

export async function createAndAttachAgentSession(options: {
  readonly tool: Tool;
  readonly cwd: string;
  readonly targetPane: string | null;
}): CliResultAsync<void> {
  const result = await createAgentSession({ tool: options.tool, cwd: options.cwd });
  if (Result.isFailure(result)) return result;

  return attachOrFocusAgentSession({
    session: result.value.sessionName,
    targetPane: options.targetPane,
  });
}

export async function rememberAgentSession(cwd: string, session: string): Promise<void> {
  await rememberLastAgent(cwd, session);
}
