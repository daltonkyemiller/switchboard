import { join } from "node:path";

const home = process.env["HOME"];
if (!home) {
  throw new Error("HOME is not set");
}

const xdgConfigHome = process.env["XDG_CONFIG_HOME"] ?? join(home, ".config");
const xdgDataHome = process.env["XDG_DATA_HOME"] ?? join(home, ".local", "share");
const xdgStateHome = process.env["XDG_STATE_HOME"] ?? join(home, ".local", "state");
const xdgRuntimeDir = process.env["XDG_RUNTIME_DIR"] ?? `/tmp/switchboard-${process.getuid?.() ?? "user"}`;

const configDir = join(xdgConfigHome, "switchboard");
const dataDir = join(xdgDataHome, "switchboard");
const stateDir = join(xdgStateHome, "switchboard");
const runtimeDir = join(xdgRuntimeDir, "switchboard");

export const paths = {
  configDir,
  dataDir,
  stateDir,
  runtimeDir,
  configFile: join(configDir, "config.toml"),
  grammarsFile: join(configDir, "grammars.toml"),
  grammarsDir: join(dataDir, "grammars"),
  socket: join(runtimeDir, "switchboard.sock"),
  pidFile: join(runtimeDir, "daemon.pid"),
  agentsSnapshot: join(stateDir, "agents.json"),
  logFile: join(stateDir, "daemon.log"),
} as const;
