import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./paths.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLastAgents(): Promise<Record<string, string>> {
  let raw = "";
  try {
    raw = await readFile(paths.lastAgentsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (!isRecord(parsed)) return {};

  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export async function lastAgentForCwd(cwd: string): Promise<string | null> {
  const agents = await readLastAgents();
  return agents[cwd] ?? null;
}

export async function rememberLastAgent(cwd: string, session: string): Promise<void> {
  const agents = await readLastAgents();
  await mkdir(dirname(paths.lastAgentsFile), { recursive: true });
  await writeFile(paths.lastAgentsFile, JSON.stringify({ ...agents, [cwd]: session }, null, 2));
}
