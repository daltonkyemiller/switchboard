export type FileHit = {
  readonly kind: "file";
  readonly path: string;
  readonly fileName: string;
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
  const slash = p.lastIndexOf("/");
  return slash >= 0 ? p.slice(slash + 1) : p;
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

async function listAllFiles(cwd: string, limit: number): Promise<readonly FileHit[]> {
  const text = await run(
    ["fd", "--type", "f", "--hidden", "--exclude", ".git", "--color=never", "--max-results", String(limit)],
    cwd,
  );
  return text
    .split("\n")
    .filter(Boolean)
    .map((path) => ({ kind: "file" as const, path, fileName: basename(path) }));
}

async function findFiles(query: string, cwd: string, limit: number): Promise<readonly FileHit[]> {
  const text = await run(
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
      query,
    ],
    cwd,
  );
  return text
    .split("\n")
    .filter(Boolean)
    .map((path) => ({ kind: "file" as const, path, fileName: basename(path) }));
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
  return {
    async searchFiles(query, limit = 50) {
      if (!query) return listAllFiles(basePath, limit);
      return findFiles(query, basePath, limit);
    },
    async searchContent(query, limit = 50) {
      if (!query) return [];
      return grepContent(query, basePath, limit);
    },
    destroy() {},
  };
}
