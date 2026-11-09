const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const publicRoot = path.join(root, "public");
for (const envPath of [path.join(root, ".env"), path.resolve(root, "..", ".env")]) {
  if (fs.existsSync(envPath)) {
    if (typeof process.loadEnvFile !== "function") {
      throw new Error("Loading local .env files requires Node.js 20.12 or newer.");
    }
    process.loadEnvFile(envPath);
  }
}
const port = Number(process.env.PORT) || 3000;
const bodyLimit = 2 * 1024 * 1024;
const apiHandlers = new Map([
  ["/api/assistant", require("../api/assistant")],
  ["/api/contact", require("../api/contact")],
  ["/api/gallery-caption", require("../api/gallery-caption")]
]);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".ogv": "video/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp"
};

function isWithin(directory, filePath) {
  return filePath === directory || filePath.startsWith(`${directory}${path.sep}`);
}

function isBlockedPath(filePath) {
  const relativePath = path.relative(root, filePath);
  return relativePath.split(path.sep).some((part) =>
    part.startsWith(".") || ["api", "node_modules", "scripts"].includes(part)
  );
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > bodyLimit) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function handleApi(request, response, handler) {
  try {
    request.body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.message });
    return;
  }

  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (data) => sendJson(response, response.statusCode || 200, data);

  try {
    await handler(request, response);
    if (!response.writableEnded) sendJson(response, 204, {});
  } catch (error) {
    console.error("Local API request failed.", error);
    if (!response.headersSent) sendJson(response, 500, { error: "The local API request failed." });
    else response.destroy(error);
  }
}

function resolveStaticFile(urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0")) return null;

  const relativePath = decodedPath.replace(/^[/\\]+/, "");
  const candidates = [
    path.resolve(root, relativePath),
    path.resolve(publicRoot, relativePath)
  ];
  for (const candidate of candidates) {
    if (!isWithin(root, candidate) || isBlockedPath(candidate)) continue;
    if (!isWithin(publicRoot, candidate) && candidate !== root && !isWithin(root, candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
  return null;
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const apiHandler = apiHandlers.get(requestUrl.pathname);
  if (apiHandler) {
    await handleApi(request, response, apiHandler);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.writeHead(405).end("Method Not Allowed");
    return;
  }

  const requestPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  let filePath;
  try {
    filePath = resolveStaticFile(requestPath);
  } catch (error) {
    console.error("Could not resolve a local static file.", error);
    response.writeHead(500).end("Could not read the requested file.");
    return;
  }
  if (!filePath) {
    response.writeHead(404).end("Not Found");
    return;
  }

  const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  response.setHeader("Content-Type", contentType);
  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    console.error("Could not serve a local static file.", error);
    if (!response.headersSent) response.writeHead(500);
    response.end("Could not read the requested file.");
  });
  if (request.method === "HEAD") {
    stream.destroy();
    response.writeHead(200).end();
    return;
  }
  response.writeHead(200);
  stream.pipe(response);
});

server.on("error", (error) => {
  console.error(`Could not start the local development server on port ${port}.`, error);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local site and API available at http://127.0.0.1:${port}`);
});
