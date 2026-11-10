'use strict';
// Tiny HTTP framework: router, body parsing, cookies, responses, static files, security headers.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ValidationError } = require('./util');

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra); } }

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params = {};
      r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > limit) { reject(new HttpError(413, 'حجم البيانات كبير جداً')); req.resume(); return; }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'حجم البيانات كبير جداً')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function jsonBody(req, limit = 256 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) throw new HttpError(415, 'يجب إرسال البيانات بصيغة JSON');
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'صيغة JSON غير صالحة'); }
}

function clientIp(req) {
  if (process.env.TRUST_PROXY !== 'false') {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || '';
}

function send(req, res, status, body, type, extraHeaders = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  const headers = { 'Content-Type': type, ...extraHeaders };
  const ae = String(req.headers['accept-encoding'] || '');
  if (buf.length > 1024 && /\b(gzip)\b/.test(ae) && /text|json|javascript|svg|xml/.test(type)) {
    buf = zlib.gzipSync(buf, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const sendJson = (req, res, status, obj, headers = {}) => send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...headers });
const sendHtml = (req, res, status, htmlStr, headers = {}) => send(req, res, status, String(htmlStr), 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache', ...headers });
function redirect(res, location, status = 302) { res.writeHead(status, { Location: location, 'Content-Length': 0 }); res.end(); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const staticCache = new Map();
function serveStatic(root) {
  const rootAbs = path.resolve(root);
  return (req, res, pathname) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel; try { rel = decodeURIComponent(pathname); } catch { return false; }
    const file = path.resolve(rootAbs, '.' + rel);
    if (!file.startsWith(rootAbs + path.sep)) return false;
    let st; try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return true; }
    let cached = staticCache.get(file);
    if (!cached || cached.etag !== etag) { cached = { etag, buf: fs.readFileSync(file) }; staticCache.set(file, cached); }
    const ext = path.extname(file).toLowerCase();
    // versioned assets (?v=) can be cached long; others revalidate
    const cc = req.url.includes('?v=') ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
    send(req, res, 200, cached.buf, MIME[ext] || 'application/octet-stream', { ETag: etag, 'Cache-Control': cc });
    return true;
  };
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function errorPayload(e) {
  if (e instanceof ValidationError) return { status: 400, body: { error: Object.values(e.errors)[0] || e.message, fields: e.errors } };
  if (e && e.status && e.status < 500) {
    const body = { error: e.message };
    if (e.quote) body.quote = e.quote;
    if (e.login) body.login = true;
    if (e.fields) body.fields = e.fields;
    return { status: e.status, body };
  }
  return { status: 500, body: { error: 'حدث خطأ غير متوقع في الخادم' } };
}

module.exports = { HttpError, Router, parseCookies, readBody, jsonBody, clientIp, send, sendJson, sendHtml, redirect, serveStatic, securityHeaders, errorPayload };
