import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getGrammarRegistry } from "./grammar-registry.ts";

const MAX_BYTES = 256 * 1024;

export type PreviewContent = {
  readonly text: string;
  readonly filetype: string | null;
  readonly truncated: boolean;
  readonly isPartial: boolean;
};

export async function loadPreview(absPath: string): Promise<PreviewContent | null> {
  try {
    const info = await stat(absPath);
    if (!info.isFile()) return null;
    const registry = await getGrammarRegistry();
    const lang = registry.resolveFiletype(absPath);
    if (info.size > MAX_BYTES) {
      const buffer = Buffer.alloc(MAX_BYTES);
      const fd = await (await import("node:fs/promises")).open(absPath, "r");
      try {
        await fd.read(buffer, 0, MAX_BYTES, 0);
      } finally {
        await fd.close();
      }
      return { text: buffer.toString("utf8"), filetype: lang, truncated: true, isPartial: true };
    }
    const text = await readFile(absPath, "utf8");
    return { text, filetype: lang, truncated: false, isPartial: false };
  } catch {
    return null;
  }
}

export function sliceAround(text: string, lineNumber: number, context = 20): { text: string; startLine: number } {
  if (lineNumber <= 0) return { text, startLine: 1 };
  const lines = text.split("\n");
  const start = Math.max(0, lineNumber - 1 - context);
  const end = Math.min(lines.length, lineNumber - 1 + context);
  return { text: lines.slice(start, end).join("\n"), startLine: start + 1 };
}

export function buildAbsPath(cwd: string, relative: string): string {
  return join(cwd, relative);
}
