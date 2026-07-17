import { startLocalApi } from "./server.js";

await startLocalApi({ appMode: "dev" }).then((api) => {
  console.log(`Workspace local API listening on ${api.origin}`);
});
