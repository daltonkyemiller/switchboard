import { Result } from "@praha/byethrow";
import {
  releaseNvimContext,
  reportNvimContext,
  saveNvimContextFile,
  type NvimContextPayload,
} from "../shared/nvim-context.ts";

function usage(): never {
  console.error("usage: switchboard nvim-context report|release");
  process.exit(1);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

async function readPayload(): Promise<NvimContextPayload> {
  const raw = await new Response(Bun.stdin.stream()).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("invalid nvim context json");
    process.exit(1);
  }

  if (typeof parsed !== "object" || parsed === null) {
    console.error("invalid nvim context payload");
    process.exit(1);
  }

  const obj = parsed as Record<string, unknown>;
  const cwd = asString(obj["cwd"]);
  if (!cwd) {
    console.error("nvim context missing cwd");
    process.exit(1);
  }

  return {
    version: typeof obj["version"] === "number" ? obj["version"] : undefined,
    cwd,
    tmux_pane: asString(obj["tmux_pane"]) ?? undefined,
    updated_at: typeof obj["updated_at"] === "number" ? obj["updated_at"] : undefined,
    current_file: asString(obj["current_file"]),
    alternate_file: asString(obj["alternate_file"]),
    open_buffers: asStringArray(obj["open_buffers"]),
    recent_files: asStringArray(obj["recent_files"]),
  };
}

export async function runNvimContext(args: readonly string[]): Promise<void> {
  const [command] = args;
  if (command !== "report" && command !== "release") usage();

  const payload = await readPayload();
  if (command === "report") {
    const reported = await reportNvimContext(payload);
    if (Result.isFailure(reported)) {
      await saveNvimContextFile(payload);
      console.error(reported.error.message);
      process.exit(1);
    }
    await saveNvimContextFile(payload).catch(() => {});
    return;
  }

  const released = await releaseNvimContext({
    cwd: payload.cwd,
    tmux_pane: payload.tmux_pane,
  });
  if (Result.isFailure(released)) {
    console.error(released.error.message);
    process.exit(1);
  }
}
