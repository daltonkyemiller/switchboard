import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  loadNvimPickerContext,
  type NvimContextSource,
  type NvimPickerContext,
} from "../shared/nvim-context.ts";

export type FileHit = {
  readonly kind: "file";
  readonly path: string;
  readonly fileName: string;
  readonly entryKind: "file" | "directory";
  readonly source: NvimContextSource | null;
};

export type ContentHit = {
  readonly kind: "content";
  readonly path: string;
  readonly fileName: string;
  readonly lineNumber: number;
  readonly line: string;
};

export type Hit = FileHit | ContentHit;

export type FinderHandle = {
  readonly searchFiles: (query: string, limit?: number) => Promise<readonly FileHit[]>;
  readonly searchContent: (query: string, limit?: number) => Promise<readonly ContentHit[]>;
  readonly destroy: () => void;
};

type RgJson =
  | { type: "match"; data: { path: { text: string }; line_number: number; lines: { text: string } } }
  | { type: string };

function basename(p: string): string {
  const normalized = trimTrailingSlash(p);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function trimTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function matchesQuery(path: string, query: string): boolean {
  if (!query) return true;
  return path.toLowerCase().includes(query.toLowerCase());
}

function prioritizeFiles(
  files: readonly FileHit[],
  context: NvimPickerContext | null,
  query: string,
  limit: number,
): readonly FileHit[] {
  if (!context || context.priorities.size === 0) return files;

  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const path of context.priorities.keys()) {
    if (!byPath.has(path) && matchesQuery(path, query)) {
      byPath.set(path, {
        kind: "file",
        path,
        fileName: basename(path),
        entryKind: "file",
        source: context.sources.get(path) ?? null,
      });
    }
  }

  return [...byPath.values()]
    .map((file) => ({
      ...file,
      source: context.sources.get(file.path) ?? file.source,
    }))
    .map((file, index) => ({
      file,
      index,
      priority: context.priorities.get(file.path) ?? 0,
    }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.file);
}

async function run(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const proc = Bun.spawn(args as string[], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    signal,
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
}

async function hitForPath(path: string, cwd: string): Promise<FileHit> {
  const normalized = trimTrailingSlash(path);
  const info = await lstat(join(cwd, normalized));
  return {
    kind: "file",
    path: normalized,
    fileName: basename(normalized),
    entryKind: info.isDirectory() ? "directory" : "file",
    source: null,
  };
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map(trimTrailingSlash).filter(Boolean))];
}

async function hitsFromFdOutput(text: string, cwd: string): Promise<readonly FileHit[]> {
  const paths = uniquePaths(text.split("\n"));
  return Promise.all(paths.map((path) => hitForPath(path, cwd)));
}

async function listAllFiles(cwd: string, limit: number): Promise<readonly FileHit[]> {
  const text = await run(
    [
      "fd",
      "--type",
      "f",
      "--type",
      "d",
      "--hidden",
      "--exclude",
      ".git",
      "--color=never",
      "--max-results",
      String(limit),
    ],
    cwd,
  );
  return hitsFromFdOutput(text, cwd);
}

async function findFiles(query: string, cwd: string, limit: number): Promise<readonly FileHit[]> {
  const usesPathQuery = query.includes("/");
  const text = await run(
    [
      "fd",
      ...(usesPathQuery ? ["--full-path"] : []),
      "--type",
      "f",
      "--type",
      "d",
      "--hidden",
      "--exclude",
      ".git",
      "--color=never",
      "--max-results",
      String(limit),
      query,
    ],
    cwd,
  );
  const matchedHits = await hitsFromFdOutput(text, cwd);
  const matchedDirectories = matchedHits
    .filter((hit) => hit.entryKind === "directory")
    .map((hit) => hit.path);
  if (matchedDirectories.length === 0) return matchedHits;

  const descendantText = await run(
    [
      "fd",
      "--type",
      "f",
      "--hidden",
      "--exclude",
      ".git",
      "--color=never",
      "--max-results",
      String(limit),
      ".",
      ...matchedDirectories,
    ],
    cwd,
  );
  const descendantHits = await hitsFromFdOutput(descendantText, cwd);
  return [...new Map([...matchedHits, ...descendantHits].map((hit) => [hit.path, hit])).values()]
    .slice(0, limit);
}

async function grepContent(query: string, cwd: string, limit: number): Promise<readonly ContentHit[]> {
  const text = await run(
    [
      "rg",
      "--json",
      "--smart-case",
      "--no-messages",
      "--max-count",
      "5",
      "--max-columns",
      "300",
      query,
    ],
    cwd,
  );

  const hits: ContentHit[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (hits.length >= limit) break;
    let parsed: RgJson;
    try {
      parsed = JSON.parse(line) as RgJson;
    } catch {
      continue;
    }
    if (parsed.type !== "match") continue;
    const match = parsed as Extract<RgJson, { type: "match" }>;
    hits.push({
      kind: "content",
      path: match.data.path.text,
      fileName: basename(match.data.path.text),
      lineNumber: match.data.line_number,
      line: match.data.lines.text.replace(/\n$/, ""),
    });
  }
  return hits;
}

export function createFinder(basePath: string): FinderHandle {
  const context = loadNvimPickerContext(basePath).catch(() => null);
  return {
    async searchFiles(query, limit = 50) {
      const results = query
        ? await findFiles(query, basePath, limit)
        : await listAllFiles(basePath, limit);
      return prioritizeFiles(results, await context, query, limit);
    },
    async searchContent(query, limit = 50) {
      if (!query) return [];
      return grepContent(query, basePath, limit);
    },
    destroy() {},
  };
}
