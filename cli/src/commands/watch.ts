import { connect } from "../shared/client.ts";

export async function runWatch(): Promise<void> {
  const client = await connect();
  client.onEvent((event) => {
    console.log(JSON.stringify(event));
  });
  const response = await client.request("events.subscribe", {});
  if ("error" in response) {
    console.error(`error: ${response.error.message}`);
    process.exit(1);
  }

  await new Promise<void>(() => {
    process.on("SIGINT", () => {
      client.close();
      process.exit(0);
    });
  });
}
