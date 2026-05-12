import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { paths } from "./paths.ts";

type NvimContextJson = {
  readonly cwd?: unknown;
  readonly current_file?: unknown;
  readonly alternate_file?: unknown;
  readonly open_buffers?: unknown;
  readonly recent_files?: unknown;
};

export type NvimPickerContext = {
  readonly priorities: ReadonlyMap<string, number>;
  readonly sources: ReadonlyMap<string, NvimContextSource>;
};

export type NvimContextSource = "current" | "alternate" | "buffer" | "recent";

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

export async function loadNvimPickerContext(cwd: string): Promise<NvimPickerContext | null> {
  const normalizedCwd = await normalizePath(cwd);
  let raw = "";
  try {
    raw = await readFile(contextFile(normalizedCwd), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const parsed = JSON.parse(raw) as NvimContextJson;
  if (asString(parsed.cwd) !== normalizedCwd) return null;

  const priorities = new Map<string, number>();
  const sources = new Map<string, NvimContextSource>();
  addPriority(priorities, sources, relativeFile(normalizedCwd, asString(parsed.current_file)), 10_000, "current");
  addPriority(priorities, sources, relativeFile(normalizedCwd, asString(parsed.alternate_file)), 9_000, "alternate");

  asStringArray(parsed.open_buffers).forEach((file, index) => {
    addPriority(priorities, sources, relativeFile(normalizedCwd, file), 8_000 - index, "buffer");
  });
  asStringArray(parsed.recent_files).forEach((file, index) => {
    addPriority(priorities, sources, relativeFile(normalizedCwd, file), 6_000 - index, "recent");
  });

  return { priorities, sources };
}
