import { Result } from "@praha/byethrow";
import { existsSync } from "node:fs";
import { addGrammarToConfig, getGrammarRegistry } from "../picker/grammar-registry.ts";
import { paths } from "../shared/paths.ts";
import { cliError } from "../shared/result.ts";

function valuesForFlag(args: readonly string[], flag: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === flag && value) {
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function valueForFlag(args: readonly string[], flag: string): string | null {
  return valuesForFlag(args, flag)[0] ?? null;
}

function printUsage(): void {
  console.error(`usage:
  switchboard grammar list
  switchboard grammar add --filetype NAME --ext EXT --wasm PATH --highlights PATH [--basename NAME] [--alias NAME] [--injections PATH]`);
}

async function runList(): Promise<void> {
  const registry = await getGrammarRegistry();
  if (registry.grammars.length === 0) {
    console.log("no grammars");
    return;
  }

  for (const grammar of registry.grammars) {
    const markers = [
      grammar.extensions.length > 0 ? grammar.extensions.join(",") : "",
      grammar.basenames.length > 0 ? grammar.basenames.join(",") : "",
    ].filter(Boolean);
    console.log(`${grammar.source.padEnd(7)} ${grammar.filetype.padEnd(18)} ${markers.join(" ")}`);
  }
}

async function runAdd(args: readonly string[]): Promise<void> {
  const filetype = valueForFlag(args, "--filetype");
  const wasm = valueForFlag(args, "--wasm");
  const highlights = valuesForFlag(args, "--highlights");
  const extensions = valuesForFlag(args, "--ext");
  const basenames = valuesForFlag(args, "--basename");
  const aliases = valuesForFlag(args, "--alias");
  const injections = valuesForFlag(args, "--injections");

  if (!filetype || !wasm || highlights.length === 0 || extensions.length + basenames.length === 0) {
    printUsage();
    process.exit(1);
  }

  const missing = [wasm, ...highlights, ...injections].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    console.error(`missing grammar files: ${missing.join(", ")}`);
    process.exit(1);
  }

  await addGrammarToConfig({
    filetype,
    extensions,
    basenames,
    aliases,
    wasm,
    highlights,
    injections,
  });
  console.log(`registered ${filetype} in ${paths.grammarsFile}`);
}

export async function runGrammar(args: readonly string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const result = await Result.try({
    try: async () => {
      if (subcommand === "list") {
        await runList();
        return;
      }
      if (subcommand === "add") {
        await runAdd(rest);
        return;
      }
      printUsage();
      process.exit(1);
    },
    catch: (error) => cliError("failed to manage grammars", error),
  });
  if (Result.isFailure(result)) {
    console.error(`failed: ${result.error.message}`);
    process.exit(1);
  }
}
