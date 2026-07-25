"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;

function loadLocalEnvironment(file = path.join(ROOT, ".env.local")) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    process.env[match[1]] = value;
  }
  return true;
}

if (!loadLocalEnvironment()) loadLocalEnvironment(path.join(ROOT, ".env.example"));
const PORT = Number(process.env.PORT || 4000);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"
};

function responseAdapter(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(data)); };
  return res;
}

async function hydrateVercelJsonBody(req) {
  if (req.body !== undefined || !["POST", "PUT", "PATCH"].includes(req.method)) return;
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
  }
  try { req.body = raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }); }
}

async function routeApi(req, res, pathname) {
  const name = pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9-]+$/i.test(name)) return false;
  const file = path.join(ROOT, "api", `${name}.js`);
  if (!fs.existsSync(file)) return false;
  try {
    // Vercel supplies req.body to legacy functions. Hydrate only the production
    // router here so its GitHub reference implementation remains untouched.
    if (name === "grade-ielts-production-router") await hydrateVercelJsonBody(req);
    await require(file)(req, responseAdapter(res));
  }
  catch (error) { if (!res.headersSent) responseAdapter(res).status(500).json({ ok: false, error: "LOCAL_API_ERROR", detail: error.message }); }
  return true;
}

function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(ROOT, relative);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) { res.statusCode = 403; return res.end("Forbidden"); }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(ROOT, "index.html");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", MIME[path.extname(target).toLowerCase()] || "application/octet-stream");
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (pathname.startsWith("/api/") && await routeApi(req, res, pathname)) return;
  serveStatic(res, pathname);
});

if (require.main === module) server.listen(PORT, "127.0.0.1", () => console.log(`IELTS Writing Hub: http://127.0.0.1:${PORT}`));
module.exports = { server, PORT, loadLocalEnvironment, hydrateVercelJsonBody };
