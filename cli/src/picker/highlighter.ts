import { join } from "node:path";
import { TreeSitterClient } from "@opentui/core";
import { paths } from "../shared/paths.ts";
import { getGrammarRegistry } from "./grammar-registry.ts";

let cached: Promise<TreeSitterClient> | null = null;

export function getHighlighter(): Promise<TreeSitterClient> {
  if (cached) return cached;
  cached = (async () => {
    const dataPath = join(paths.stateDir, "tree-sitter");
    const client = new TreeSitterClient({ dataPath });
    await client.initialize();
    const registry = await getGrammarRegistry();
    for (const grammar of registry.userGrammars) {
      if (grammar.parser) client.addFiletypeParser(grammar.parser);
    }
    return client;
  })();
  return cached;
}
