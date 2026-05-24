import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { Result } from "@praha/byethrow";
import { connect } from "./client.ts";
import { paths } from "./paths.ts";

export type NvimContextPayload = {
  readonly version?: number;
  readonly cwd: string;
  readonly tmux_pane?: string;
  readonly updated_at?: number;
  readonly current_file?: string | null;
  readonly alternate_file?: string | null;
  readonly open_buffers?: readonly string[];
  readonly recent_files?: readonly string[];
};

export type NvimPickerContext = {
  readonly priorities: ReadonlyMap<string, number>;
  readonly sources: ReadonlyMap<string, NvimContextSource>;
};

export type NvimContextSource = "current" | "alternate" | "buffer" | "recent";

type DaemonNvimContextResult =
  | { readonly kind: "available"; readonly context: NvimContextPayload | null }
  | { readonly kind: "unavailable" };

const RECENT_CONTEXT_FALLBACK_MS = 30_000;

function contextFile(cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return `${paths.nvimContextDir}/${hash}.json`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parsePayload(value: unknown): NvimContextPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const cwd = asString(obj["cwd"]);
  if (!cwd) return null;

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

async function normalizePath(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

function relativeFile(cwd: string, file: string | null): string | null {
  if (!file) return null;
  const rel = relative(cwd, file).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || rel.startsWith("/")) return null;
  if (!existsSync(file)) return null;
  return rel;
}

export async function normalizeNvimCwd(cwd: string): Promise<string> {
  return normalizePath(cwd);
}

export function nvimContextFile(cwd: string): string {
  return contextFile(cwd);
}

export async function saveNvimContextFile(payload: NvimContextPayload): Promise<void> {
  const normalizedCwd = await normalizePath(payload.cwd);
  await mkdir(paths.nvimContextDir, { recursive: true });
  await writeFile(contextFile(normalizedCwd), `${JSON.stringify({ ...payload, cwd: normalizedCwd })}\n`);
}

function addPriority(
  priorities: Map<string, number>,
  sources: Map<string, NvimContextSource>,
  path: string | null,
  score: number,
  source: NvimContextSource,
): void {
  if (!path) return;
  const existing = priorities.get(path) ?? 0;
  if (score > existing) {
    priorities.set(path, score);
    sources.set(path, source);
  }
}

export async function pickerContextFromPayload(
  cwd: string,
  payload: NvimContextPayload,
): Promise<NvimPickerContext | null> {
  const normalizedCwd = await normalizePath(cwd);
  if (await normalizePath(payload.cwd) !== normalizedCwd) return null;

  const priorities = new Map<string, number>();
  const sources = new Map<string, NvimContextSource>();
  addPriority(priorities, sources, relativeFile(normalizedCwd, payload.current_file ?? null), 10_000, "current");
  addPriority(priorities, sources, relativeFile(normalizedCwd, payload.alternate_file ?? null), 9_000, "alternate");

  (payload.open_buffers ?? []).forEach((file, index) => {
    addPriority(priorities, sources, relativeFile(normalizedCwd, file), 8_000 - index, "buffer");
  });
  (payload.recent_files ?? []).forEach((file, index) => {
    addPriority(priorities, sources, relativeFile(normalizedCwd, file), 6_000 - index, "recent");
  });

  return { priorities, sources };
}

export async function loadNvimContextFile(cwd: string): Promise<NvimContextPayload | null> {
  const normalizedCwd = await normalizePath(cwd);
  let raw = "";
  try {
    raw = await readFile(contextFile(normalizedCwd), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const parsed = parsePayload(JSON.parse(raw));
  if (!parsed) return null;
  if (await normalizePath(parsed.cwd) !== normalizedCwd) return null;
  return parsed;
}

async function loadRecentNvimContextFile(cwd: string): Promise<NvimContextPayload | null> {
  const normalizedCwd = await normalizePath(cwd);
  const info = await stat(contextFile(normalizedCwd)).catch(() => null);
  if (!info || Date.now() - info.mtimeMs > RECENT_CONTEXT_FALLBACK_MS) return null;
  return loadNvimContextFile(normalizedCwd);
}

async function loadNvimContextFromDaemon(cwd: string): Promise<DaemonNvimContextResult> {
  const client = await connect();
  const response = await client.request("nvim.context_for_cwd", { cwd }, 150);
  client.close();

  if ("error" in response) return { kind: "unavailable" };
  const result = response.result as { context?: unknown };
  return { kind: "available", context: parsePayload(result.context) };
}

export function reportNvimContext(payload: NvimContextPayload): Result.ResultAsync<void, Error> {
  return Result.try({
    try: async () => {
      const client = await connect();
      const response = await client.request("nvim.report_context", payload, 150);
      client.close();
      if ("error" in response) {
        throw new Error(response.error.message);
      }
    },
    catch: (error) => error instanceof Error ? error : new Error("failed to report nvim context"),
  });
}

export function releaseNvimContext(payload: {
  readonly cwd: string;
  readonly tmux_pane?: string;
}): Result.ResultAsync<void, Error> {
  return Result.try({
    try: async () => {
      const client = await connect();
      const response = await client.request("nvim.release_context", payload, 150);
      client.close();
      if ("error" in response) {
        throw new Error(response.error.message);
      }
    },
    catch: (error) => error instanceof Error ? error : new Error("failed to release nvim context"),
  });
}

export async function loadNvimPickerContext(cwd: string): Promise<NvimPickerContext | null> {
  const live = await loadNvimContextFromDaemon(cwd).catch((): DaemonNvimContextResult => ({ kind: "unavailable" }));
  if (live.kind === "available") {
    const payload = live.context ?? await loadRecentNvimContextFile(cwd);
    return payload ? pickerContextFromPayload(cwd, payload) : null;
  }

  const file = await loadNvimContextFile(cwd);
  if (!file) return null;
  return pickerContextFromPayload(cwd, file);
}
