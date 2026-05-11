import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { FiletypeParserOptions } from "@opentui/core";
import { paths } from "../shared/paths.ts";

type GrammarDefinition = {
  readonly filetype: string;
  readonly extensions: readonly string[];
  readonly basenames: readonly string[];
  readonly parser: FiletypeParserOptions | null;
  readonly source: "builtin" | "user";
};

export type GrammarRegistry = {
  readonly grammars: readonly GrammarDefinition[];
  readonly userGrammars: readonly GrammarDefinition[];
  readonly resolveFiletype: (path: string) => string | null;
};

type GrammarConfig = {
  readonly grammar?: unknown;
};

const BUILTIN_GRAMMARS: readonly GrammarDefinition[] = [
  {
    filetype: "typescript",
    extensions: [".ts", ".mts", ".cts"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "typescriptreact",
    extensions: [".tsx"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "javascript",
    extensions: [".js", ".mjs", ".cjs"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "javascriptreact",
    extensions: [".jsx"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "markdown",
    extensions: [".md", ".markdown"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "json",
    extensions: [".json"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "css",
    extensions: [".css"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "html",
    extensions: [".html", ".htm"],
    basenames: [],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "dockerfile",
    extensions: [],
    basenames: ["Dockerfile"],
    parser: null,
    source: "builtin",
  },
  {
    filetype: "make",
    extensions: [],
    basenames: ["Makefile"],
    parser: null,
    source: "builtin",
  },
];

let cached: Promise<GrammarRegistry> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeExtension(value: string): string {
  return value.startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`;
}

function resolveConfigPath(value: string): string {
  const expanded = value.startsWith("~/") ? join(process.env["HOME"] ?? "", value.slice(2)) : value;
  if (isAbsolute(expanded)) return expanded;
  return resolve(dirname(paths.grammarsFile), expanded);
}

function parseUserGrammar(value: unknown): GrammarDefinition | null {
  if (!isRecord(value)) return null;

  const filetype = asString(value["filetype"]);
  const wasm = asString(value["wasm"]);
  const highlights = asStringArray(value["highlights"]);
  if (!filetype || !wasm || highlights.length === 0) return null;

  const injections = asStringArray(value["injections"]);
  const extensions = asStringArray(value["extensions"]).map(normalizeExtension);
  const basenames = asStringArray(value["basenames"]);
  const aliases = asStringArray(value["aliases"]);

  return {
    filetype,
    extensions,
    basenames,
    source: "user",
    parser: {
      filetype,
      aliases,
      wasm: resolveConfigPath(wasm),
      queries: {
        highlights: highlights.map(resolveConfigPath),
        ...(injections.length > 0 ? { injections: injections.map(resolveConfigPath) } : {}),
      },
    },
  };
}

async function loadUserGrammars(): Promise<readonly GrammarDefinition[]> {
  let raw = "";
  try {
    raw = await readFile(paths.grammarsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const parsed = Bun.TOML.parse(raw) as GrammarConfig;
  const entries = Array.isArray(parsed.grammar) ? parsed.grammar : [];
  return entries.flatMap((entry) => {
    const grammar = parseUserGrammar(entry);
    return grammar ? [grammar] : [];
  });
}

function createRegistry(userGrammars: readonly GrammarDefinition[]): GrammarRegistry {
  const grammars = [...userGrammars, ...BUILTIN_GRAMMARS];

  return {
    grammars,
    userGrammars,
    resolveFiletype(path) {
      const name = basename(path);
      const extension = extname(path).toLowerCase();
      return (
        grammars.find((grammar) => grammar.basenames.includes(name))?.filetype ??
        grammars.find((grammar) => grammar.extensions.includes(extension))?.filetype ??
        null
      );
    },
  };
}

export function getGrammarRegistry(): Promise<GrammarRegistry> {
  cached ??= loadUserGrammars().then(createRegistry);
  return cached;
}

export async function addGrammarToConfig(options: {
  readonly filetype: string;
  readonly extensions: readonly string[];
  readonly basenames: readonly string[];
  readonly aliases: readonly string[];
  readonly wasm: string;
  readonly highlights: readonly string[];
  readonly injections: readonly string[];
}): Promise<void> {
  await mkdir(dirname(paths.grammarsFile), { recursive: true });
  const lines = [
    "[[grammar]]",
    `filetype = ${JSON.stringify(options.filetype)}`,
    `extensions = ${JSON.stringify(options.extensions.map(normalizeExtension))}`,
    `basenames = ${JSON.stringify(options.basenames)}`,
    `aliases = ${JSON.stringify(options.aliases)}`,
    `wasm = ${JSON.stringify(options.wasm)}`,
    `highlights = ${JSON.stringify(options.highlights)}`,
  ];
  if (options.injections.length > 0) {
    lines.push(`injections = ${JSON.stringify(options.injections)}`);
  }

  let existing = "";
  try {
    existing = await readFile(paths.grammarsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const prefix = existing.trim().length > 0 ? `${existing.replace(/\n*$/, "\n\n")}` : "";
  await writeFile(paths.grammarsFile, `${prefix}${lines.join("\n")}\n`);
  cached = null;
}
