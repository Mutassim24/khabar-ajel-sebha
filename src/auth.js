'use strict';
// Admin authentication: scrypt password hashes, HMAC-signed session cookies, login rate limiting.
const crypto = require('crypto');
const { get, run, sessionSecret } = require('./db');

const COOKIE = 'ka_admin';
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const hash = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(h, 'base64');
    return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
  } catch { return false; }
}
// Dummy hash so unknown-email logins take the same time as wrong-password logins.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac || ''); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

function isSecure(req) {
  return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
}
function setSessionCookie(req, res, admin) {
  const token = sign({ uid: admin.id, v: admin.token_version, exp: Date.now() + SESSION_HOURS * 3600e3 });
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_HOURS * 3600}`];
  if (isSecure(req)) parts.push('Secure');
  res.appendHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(req, res) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isSecure(req)) parts.push('Secure');
  res.appendHeader('Set-Cookie', parts.join('; '));
}
function currentAdmin(req) {
  const p = unsign(req.cookies[COOKIE]);
  if (!p) return null;
  const a = get('SELECT id, name, email, role, active, token_version FROM admins WHERE id = ?', p.uid);
  if (!a || !a.active || a.token_version !== p.v) return null;
  return a;
}

// Simple in-memory sliding-window rate limiter.
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  if (buckets.size > 50000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) };
}

function login(email, password) {
  const a = get('SELECT * FROM admins WHERE email = ?', String(email || '').trim());
  const ok = verifyPassword(password, a ? a.password_hash : DUMMY_HASH);
  if (!a || !ok || !a.active) return null;
  run("UPDATE admins SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", a.id);
  return a;
}

/** Ensure an owner account exists. Uses ADMIN_EMAIL / ADMIN_PASSWORD; otherwise generates a one-time password. */
function bootstrapAdmin() {
  if (get('SELECT 1 AS x FROM admins LIMIT 1')) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@store.local').trim();
  let pw = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!pw || pw.length < 8) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
  run("INSERT INTO admins(name, email, password_hash, role) VALUES(?, ?, ?, 'owner')", 'مدير المتجر', email, hashPassword(pw));
  console.log('\n========================================================');
  console.log(' تم إنشاء حساب مدير المتجر | Admin account created');
  console.log(`  Email: ${email}`);
  if (generated) console.log(`  Password (generated, change it after login): ${pw}`);
  else console.log('  Password: (from ADMIN_PASSWORD env variable)');
  console.log('========================================================\n');
}

module.exports = { COOKIE, hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, currentAdmin, rateLimit, login, bootstrapAdmin };
