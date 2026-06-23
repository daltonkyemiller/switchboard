export const PI_EXTENSION_FILENAME = "switchboard-agent-state.ts";

export const PI_EXTENSION_SCRIPT = `// installed by switchboard
// safe to edit. this extension only fires when a switchboard daemon socket exists.
// SWITCHBOARD_INTEGRATION_ID=pi
// SWITCHBOARD_INTEGRATION_VERSION=1

import fs from "node:fs";
import net from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SOURCE = "switchboard:pi";

type SwitchboardState = "working" | "idle" | "blocked";
type SwitchboardAction = SwitchboardState | "release";

function resolvePaneId(): string {
  return process.env.SWITCHBOARD_PANE_ID || process.env.TMUX_PANE || "";
}

function resolveSocketPath(): string {
  if (process.env.SWITCHBOARD_SOCKET_PATH) return process.env.SWITCHBOARD_SOCKET_PATH;
  const runtime = process.env.XDG_RUNTIME_DIR || "/tmp";
  return \`\${runtime}/switchboard/switchboard.sock\`;
}

let reportSeq = Date.now() * 1000;
function nextReportSeq(): number {
  reportSeq += 1;
  return reportSeq;
}

function promptPreview(prompt: unknown): string | undefined {
  if (typeof prompt !== "string") return undefined;
  const preview = prompt.replace(/\\s+/g, " ").trim().slice(0, 80);
  return preview.length > 0 ? preview : undefined;
}

function reportState(action: SwitchboardAction, prompt?: unknown): Promise<void> {
  const paneId = resolvePaneId();
  const socketPath = resolveSocketPath();
  if (!paneId) return Promise.resolve();

  try {
    if (!fs.statSync(socketPath).isSocket()) return Promise.resolve();
  } catch {
    return Promise.resolve();
  }

  const id = \`\${SOURCE}:\${Date.now()}:\${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}\`;
  const preview = promptPreview(prompt);
  const params =
    action === "release"
      ? { pane_id: paneId, source: SOURCE, agent: "pi", seq: nextReportSeq() }
      : {
          pane_id: paneId,
          source: SOURCE,
          agent: "pi",
          state: action,
          seq: nextReportSeq(),
          pid: process.pid,
          ...(preview ? { prompt_preview: preview } : {}),
        };
  const request = {
    id,
    method: action === "release" ? "pane.release_agent" : "pane.report_agent",
    params,
  };

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.write(\`\${JSON.stringify(request)}\\n\`);
    });
    const finish = () => {
      client.destroy();
      resolve();
    };
    client.setTimeout(500, finish);
    client.on("data", finish);
    client.on("error", finish);
    client.on("end", finish);
    client.on("close", resolve);
  });
}

export default function switchboardPiExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    await reportState("idle");
  });

  pi.on("before_agent_start", async (event) => {
    await reportState("working", event.prompt);
  });

  pi.on("agent_start", async () => {
    await reportState("working");
  });

  pi.on("tool_call", async () => {
    await reportState("working");
  });

  pi.on("agent_end", async () => {
    await reportState("idle");
  });

  pi.on("session_shutdown", async () => {
    await reportState("release");
  });
}
`;
