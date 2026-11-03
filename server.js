'use strict';
// خبر عاجل سبها — e-commerce server. Zero external dependencies: Node.js >= 22.5 (built-in node:sqlite).
const fs = require('fs');
const path = require('path');
const http = require('http');

// Load .env (simple KEY=VALUE parser) before anything reads process.env
(() => {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
})();

const db = require('./src/db');
const auth = require('./src/auth');
const { Router, parseCookies, serveStatic, securityHeaders, sendJson, sendHtml, send, errorPayload } = require('./src/http');
const views = require('./src/views');
const store = require('./src/store');

db.seed();
auth.bootstrapAdmin();

const router = new Router();
require('./src/public-routes').register(router);
require('./src/admin-routes').register(router);
router.get('/healthz', (req, res) => { db.get('SELECT 1 AS ok'); sendJson(req, res, 200, { ok: true }); });
router.get('/admin', (req, res) => {
  const file = path.join(__dirname, 'public', 'admin', 'index.html');
  send(req, res, 200, fs.readFileSync(file), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
});

const statics = serveStatic(path.join(__dirname, 'public'));

// Categories are needed on every page (navigation); cache briefly.
let catCache = { at: 0, data: [] };
function navCategories() {
  if (Date.now() - catCache.at > 5000) catCache = { at: Date.now(), data: store.categoriesWithCounts(false) };
  return catCache.data;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  const pathname = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req.headers.cookie);
  req.ctx = {};
  securityHeaders(res);
  const isApi = pathname.startsWith('/api/');
  try {
    if (pathname !== '/' && pathname.endsWith('/') && !isApi) { res.writeHead(301, { Location: pathname.slice(0, -1) + url.search }); return res.end(); }
    if (statics(req, res, pathname)) return;
    const m = router.match(req.method, pathname);
    if (!m) {
      if (isApi) return sendJson(req, res, 404, { error: 'غير موجود' });
      req.ctx.categories = navCategories();
      return sendHtml(req, res, 404, views.notFound(req));
    }
    if (m.methodNotAllowed) return sendJson(req, res, 405, { error: 'Method not allowed' });
    if (!isApi) req.ctx.categories = navCategories();
    for (const h of m.route.handlers) await h(req, res, m.params);
  } catch (e) {
    const { status, body } = errorPayload(e);
    if (status >= 500) console.error(`[error] ${req.method} ${req.url}`, e);
    if (res.headersSent) return res.end();
    if (isApi || String(req.headers.accept || '').includes('application/json')) return sendJson(req, res, status, body);
    req.ctx.categories = req.ctx.categories || [];
    sendHtml(req, res, status, status === 404 ? views.notFound(req) : views.errorPage(req));
  } finally {
    if (process.env.LOG_REQUESTS === 'true') res.on('finish', () => console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`));
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`✅ ${db.getSettings().store_name} running on http://localhost:${PORT}  (database: ${db.DB_FILE})`));
  const shutdown = () => { server.close(() => { try { db.db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
module.exports = { server };
