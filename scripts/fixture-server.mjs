import { createServer } from "node:http";

const PORT = 41739;
const MAX_BODY = 20 * 1024 * 1024;
let delayedRequests = 0;

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("fixture body exceeds limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:" + PORT);
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "*");
  response.setHeader("access-control-allow-methods", "*");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    return;
  }
  if (url.pathname === "/page") {
    response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>fixture</title>");
    return;
  }
  if (url.pathname === "/stats") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ delayed: delayedRequests }));
    return;
  }
  if (url.pathname === "/delayed") {
    delayedRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, Number(url.searchParams.get("ms") ?? 1000)));
  }

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    response.writeHead(413).end(String(error));
    return;
  }

  const result = {
    method: request.method,
    path: url.pathname,
    query: [...url.searchParams.entries()],
    headers: request.headers,
    bodyText: body.toString("utf8"),
    bodyLength: body.length,
    contentType: request.headers["content-type"] ?? ""
  };
  if (url.pathname === "/redirect") {
    response.writeHead(302, { location: "/echo" }).end("redirect body");
  } else if (url.pathname === "/error") {
    response.writeHead(422, { "content-type": "application/json", "x-fixture-error": "kept" }).end('{"error":"fixture"}');
  } else if (url.pathname === "/empty") {
    response.writeHead(204).end();
  } else if (url.pathname === "/binary") {
    response.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.from([0, 1, 2, 255]));
  } else if (url.pathname === "/text") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("fixture text");
  } else if (url.pathname === "/html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end('<img src=x onerror="window.__ctoolInjected=true"><script>window.__ctoolInjected=true</script>fixture html');
  } else {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  }
});

server.listen(PORT, "127.0.0.1");
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
