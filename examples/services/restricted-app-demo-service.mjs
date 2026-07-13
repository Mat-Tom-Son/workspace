import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const loopbackHost = "127.0.0.1";

export async function startRestrictedAppDemoService({ port = 4317 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("Demo service port must be an integer from 0 through 65535.");
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${loopbackHost}`);

    if (url.pathname === "/health") {
      if (request.method !== "GET") return methodNotAllowed(response, "GET");
      return writeJson(response, 200, { ok: true, service: "restricted-app-demo-service", status: "ready" });
    }

    if (url.pathname === "/jobs/refresh") {
      if (request.method !== "POST") return methodNotAllowed(response, "POST");
      request.resume();
      return writeJson(response, 202, { ok: true, job: "refresh", status: "accepted" });
    }

    return writeJson(response, 404, { ok: false, error: "Not found" });
  });

  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => rejectListen(error);
    server.once("error", onError);
    server.listen({ host: loopbackHost, port, exclusive: true }, () => {
      server.off("error", onError);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Demo service did not bind a TCP loopback address.");
  }

  return Object.freeze({
    host: loopbackHost,
    port: address.port,
    origin: `http://${loopbackHost}:${address.port}`,
    close: () => closeServer(server),
  });
}

function methodNotAllowed(response, method) {
  response.setHeader("allow", method);
  return writeJson(response, 405, { ok: false, error: "Method not allowed" });
}

function writeJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function isDirectRun() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectRun()) {
  try {
    const service = await startRestrictedAppDemoService();
    console.log(`Restricted-app demo service listening on ${service.origin}`);
    console.log("Press Ctrl+C to stop it.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start the restricted-app demo service.");
    process.exitCode = 1;
  }
}
