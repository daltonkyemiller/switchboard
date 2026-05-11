import { startReaper } from "../daemon/reaper.ts";
import { startServer } from "../daemon/server.ts";
import { paths } from "../shared/paths.ts";

export async function runDaemon(): Promise<void> {
  console.error(`switchboard daemon listening on ${paths.socket}`);
  const stopServer = await startServer();
  const stopReaper = startReaper();

  const shutdown = async (signal: string) => {
    console.error(`\nshutting down (${signal})`);
    stopReaper();
    await stopServer();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
