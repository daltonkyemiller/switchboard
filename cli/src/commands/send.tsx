import { type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { Result } from "@praha/byethrow";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { connect } from "../shared/client.ts";
import { lastAgentForCwd, rememberLastAgent } from "../shared/last-agent.ts";
import { ensureOpenTuiRuntime } from "../shared/opentui-runtime.ts";
import { createSwitchboardRenderer } from "../shared/opentui-renderer.ts";
import { fail, fromTmux, succeed, type CliResultAsync, unwrapOrExit } from "../shared/result.ts";
import type { AgentState } from "../shared/state.ts";
import { agentTmux, popupShellCommand, shellQuote, switchboardCommand, tmux } from "../shared/tmux.ts";
import { popupClientForPane } from "../shared/tmux-pane.ts";

type SendOptions = {
  readonly cwd: string;
  readonly session: string | null;
  readonly active: boolean;
  readonly select: boolean;
  readonly submit: boolean;
  readonly text: string | null;
  readonly file: string | null;
  readonly referenceFile: string | null;
  readonly referenceLine: string | null;
  readonly unlinkFile: boolean;
};

type SendPayload =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reference"; readonly file: string; readonly line: string | null };

type SendPickerOptions = {
  readonly cwd: string;
  readonly payload: SendPayload;
  readonly submit: boolean;
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly agents: readonly AgentState[] }
  | { readonly kind: "error"; readonly message: string };

function valueForFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function parseSendOptions(args: readonly string[]): SendOptions {
  return {
    cwd: valueForFlag(args, "--cwd") ?? process.cwd(),
    session: valueForFlag(args, "--session"),
    active: hasFlag(args, "--active"),
    select: hasFlag(args, "--select"),
    submit: !hasFlag(args, "--no-submit"),
    text: valueForFlag(args, "--text"),
    file: valueForFlag(args, "--file"),
    referenceFile: valueForFlag(args, "--reference-file"),
    referenceLine: valueForFlag(args, "--reference-line"),
    unlinkFile: hasFlag(args, "--unlink-file"),
  };
}

async function payloadFromOptions(options: SendOptions): CliResultAsync<SendPayload> {
  if (options.referenceFile !== null) {
    return Result.succeed({
      kind: "reference",
      file: options.referenceFile,
      line: options.referenceLine,
    });
  }
  if (options.text !== null) return Result.succeed({ kind: "text", text: options.text });
  if (options.file) {
    const filePath = options.file;
    const result = await Result.try({
      try: () => readFile(filePath, "utf8"),
      catch: (error) => ({ message: `failed to read ${filePath}`, cause: error }),
    });
    if (Result.isFailure(result)) return result;
    return succeed({ kind: "text", text: result.value });
  }

  const text = await new Response(Bun.stdin.stream()).text();
  if (text.length === 0) return fail("no text provided");
  return Result.succeed({ kind: "text", text });
}

function payloadTextForCwd(payload: SendPayload, cwd: string): string {
  if (payload.kind === "text") return payload.text;

  const relativeFile = path.relative(cwd, payload.file).replaceAll("\\", "/");
  return `@${relativeFile}${payload.line ? `:${payload.line}` : ""} `;
}

async function loadAgents(): Promise<readonly AgentState[]> {
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

async function activeSessionForCwd(cwd: string): CliResultAsync<string> {
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

async function sendToSelectedSession(options: SendOptions): CliResultAsync<string> {
  if (options.session) return Result.succeed(options.session);
  if (options.active || !options.select) return activeSessionForCwd(options.cwd);
  return fail("select mode must run through switchboard send-popup");
}

export async function runSend(args: readonly string[]): Promise<void> {
  const options = parseSendOptions(args);
  const payload = unwrapOrExit(await payloadFromOptions(options));
  if (options.unlinkFile && options.file) {
    await unlink(options.file).catch(() => {});
  }
  if (options.select) {
    await runSendSelector({ cwd: options.cwd, payload, submit: options.submit });
    return;
  }

  const session = unwrapOrExit(await sendToSelectedSession(options));
  const text = payloadTextForCwd(payload, options.cwd);
  unwrapOrExit(await sendTextToAgentSession(session, text, { submit: options.submit }));
  await rememberLastAgent(options.cwd, session);
}

export async function runSendPopup(args: readonly string[]): Promise<void> {
  const bindingPane = args[0]?.startsWith("--") ? process.env["TMUX_PANE"] ?? "" : args[0] ?? process.env["TMUX_PANE"] ?? "";
  const optionArgs = args[0]?.startsWith("--") ? args : args.slice(1);
  const options = parseSendOptions(optionArgs);
  const popupClient = await popupClientForPane(bindingPane);
  const command = [
    switchboardCommand(),
    "send",
    "--select",
    "--cwd",
    shellQuote(options.cwd),
    options.file ? `--file ${shellQuote(options.file)}` : "",
    options.unlinkFile ? "--unlink-file" : "",
    options.text !== null ? `--text ${shellQuote(options.text)}` : "",
    options.referenceFile !== null ? `--reference-file ${shellQuote(options.referenceFile)}` : "",
    options.referenceLine !== null ? `--reference-line ${shellQuote(options.referenceLine)}` : "",
    options.submit ? "" : "--no-submit",
  ].filter(Boolean).join(" ");

  await tmux([
    "display-popup",
    ...(popupClient ? ["-c", popupClient] : []),
    "-E",
    "-w",
    "72",
    "-h",
    "20",
    "-d",
    options.cwd,
    "-b",
    "rounded",
    "-T",
    " switchboard send ",
    popupShellCommand(command, "switchboard send popup"),
  ]);
}

async function runSendSelector(options: SendPickerOptions): Promise<void> {
  await ensureOpenTuiRuntime();
  const renderer = await createSwitchboardRenderer();
  createRoot(renderer).render(<SendPickerApp options={options} />);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function SendPickerApp({ options }: { readonly options: SendPickerOptions }) {
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const resultsRef = useRef<ScrollBoxRenderable | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [tab, setTab] = useState<"cwd" | "all">("cwd");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAgents()
      .then((agents) => {
        if (!cancelled) setState({ kind: "ready", agents });
      })
      .catch((error) => {
        const text = error instanceof Error ? error.message : "failed to load agents";
        if (!cancelled) setState({ kind: "error", message: text });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const agents = state.kind === "ready" ? state.agents : [];
    return (tab === "cwd" ? agents.filter((agent) => agent.cwd === options.cwd) : agents)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [state, tab, options.cwd]);
  const resultsHeight = Math.max(1, terminal.height - (message ? 7 : 6));

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    resultsRef.current?.scrollTo(0);
  }, [tab, options.cwd, rows.length]);

  function close(): void {
    renderer.destroy();
    process.exit(0);
  }

  async function choose(): Promise<void> {
    const agent = rows[selectedIndex];
    if (!agent) {
      close();
      return;
    }

    const text = payloadTextForCwd(options.payload, agent.cwd);
    setMessage(`sending to ${agent.session}`);
    const sent = await sendTextToAgentSession(agent.session, text, { submit: options.submit });
    if (Result.isFailure(sent)) {
      setMessage(sent.error.message);
      return;
    }
    await rememberLastAgent(agent.cwd, agent.session);
    close();
  }

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
      close();
      return;
    }
    if (key.name === "[" || key.name === "]") {
      setTab((current) => (current === "cwd" ? "all" : "cwd"));
      setSelectedIndex(0);
      return;
    }
    if (rows.length === 0) return;
    if (key.name === "j" || key.name === "down") {
      setSelectedIndex((index) => Math.min(index + 1, rows.length - 1));
      return;
    }
    if (key.name === "k" || key.name === "up") {
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (key.name === "return") {
      void choose();
    }
  });

  return (
    <box style={{ flexDirection: "column", padding: 1, flexGrow: 1, backgroundColor: "#1d2021" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
        <TabLabel active={tab === "cwd"} label="cwd" />
        <SingleLineText content=" " fg="#504945" width={1} />
        <TabLabel active={tab === "all"} label="all" />
      </box>
      <SingleLineText content={truncate(options.cwd, 72)} fg="#665c54" />
      <scrollbox
        ref={resultsRef}
        scrollY={true}
        scrollX={false}
        focusable={false}
        viewportCulling={true}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
        style={{ flexDirection: "column", marginTop: 1, height: resultsHeight, flexShrink: 1 }}
      >
        {state.kind === "loading" ? <SingleLineText content="loading agents" fg="#928374" /> : null}
        {state.kind === "error" ? <SingleLineText content={state.message} fg="#fb4934" /> : null}
        {state.kind !== "loading" && rows.length === 0 ? (
          <SingleLineText content="no agents" fg="#928374" />
        ) : null}
        {rows.map((agent, index) => (
          <AgentRow
            agent={agent}
            selected={index === selectedIndex}
          />
        ))}
      </scrollbox>
      {message ? <SingleLineText content={truncate(message, 72)} fg="#928374" /> : null}
      <SingleLineText content="[/] tabs · j/k select · enter send · q close" fg="#665c54" />
    </box>
  );
}

function TabLabel({ active, label }: { readonly active: boolean; readonly label: string }) {
  return (
    <text
      content={` ${label} `}
      fg={active ? "#ebdbb2" : "#928374"}
      bg={active ? "#3c3836" : undefined}
      wrapMode="none"
      truncate={true}
      style={{ height: 1, width: label.length + 2, flexShrink: 0 }}
    />
  );
}

function AgentRow({ agent, selected }: { readonly agent: AgentState; readonly selected: boolean }) {
  const pointer = selected ? "▍" : " ";
  const pointerColor = selected ? "#fabd2f" : "#3c3836";
  const nameColor = selected ? "#ebdbb2" : "#a89984";
  return (
    <box style={{ flexDirection: "column", height: 3 }}>
      <box style={{ flexDirection: "row", height: 1 }}>
        <SingleLineText content={`${pointer} `} fg={pointerColor} width={2} />
        <SingleLineText content={`${agent.tool} `} fg={nameColor} width={12} />
        <SingleLineText content={agent.status} fg="#928374" />
      </box>
      <box style={{ flexDirection: "row", height: 1, paddingLeft: 3 }}>
        <SingleLineText content={truncate(`${agent.session} · ${agent.cwd}`, 68)} fg="#665c54" />
      </box>
    </box>
  );
}

function SingleLineText({
  content,
  fg,
  width,
}: {
  readonly content: string;
  readonly fg: string;
  readonly width?: number;
}) {
  return (
    <text
      content={content}
      fg={fg}
      wrapMode="none"
      truncate={true}
      style={{ height: 1, width, flexShrink: width ? 0 : 1 }}
    />
  );
}
