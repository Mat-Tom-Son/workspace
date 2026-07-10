import { startLocalApi } from "./server.js";

const port = Number(process.env.WORKSPACE_LOCAL_API_PORT ?? "4327");

await startLocalApi({ port, appMode: "dev" }).then((api) => {
  console.log(`Workspace local API listening on ${api.origin}`);
});
