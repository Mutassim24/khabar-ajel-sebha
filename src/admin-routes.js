'use strict';
// Admin JSON API. Every route (except login) requires a valid session; mutating routes require same-origin + custom header.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { db, all, get, run, tx, getSettings, setSetting, refreshSearchText, uniqueSlug, DEFAULT_SETTINGS } = require('./db');
const store = require('./store');
const auth = require('./auth');
const { sendJson, send, jsonBody, clientIp, HttpError } = require('./http');
const { validate, round2, slugify, normalizePhone, STATUS, normalizeAr } = require('./util');

const TZ_OFFSET = '+02:00'; // Libya (Africa/Tripoli) is UTC+2 all year

function requireAdmin(req, role) {
  const a = auth.currentAdmin(req);
  if (!a) throw new HttpError(401, 'يجب تسجيل الدخول');
  if (role === 'owner' && a.role !== 'owner') throw new HttpError(403, 'هذه العملية متاحة لمالك المتجر فقط');
  return a;
}
function csrfCheck(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'طلب غير مسموح');
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    try { if (new URL(origin).host !== host) throw new Error(); } catch { throw new HttpError(403, 'طلب غير مسموح (مصدر مختلف)'); }
  }
}
// wrap: auth + csrf
const A = (fn, role) => async (req, res, params) => { csrfCheck(req); const admin = requireAdmin(req, role); return fn(req, res, params, admin); };

const PRODUCT_SCHEMA = {
  name: { type: 'string', required: true, min: 2, max: 160, label: 'اسم المنتج' },
  sku: { type: 'string', max: 60, label: 'رقم المنتج SKU', pattern: /^[A-Za-z0-9._\-\/]+$/, patternMsg: 'رقم SKU يقبل الأحرف الإنجليزية والأرقام و - _ . / فقط' },
  slug: { type: 'string', max: 100, label: 'الرابط' },
  category_id: { type: 'int', min: 1, label: 'القسم' },
  brand: { type: 'string', max: 80, label: 'العلامة التجارية' },
  tags: { type: 'string', max: 400, label: 'كلمات البحث' },
  short_description: { type: 'string', max: 300, label: 'الوصف المختصر' },
  description: { type: 'string', max: 10000, label: 'الوصف التفصيلي' },
  price: { type: 'number', required: true, min: 0, max: 1e7, label: 'سعر القطاعي' },
  compare_at_price: { type: 'number', min: 0, max: 1e7, label: 'السعر قبل الخصم' },
  wholesale_price: { type: 'number', min: 0, max: 1e7, label: 'سعر الجملة' },
  wholesale_min_qty: { type: 'int', min: 1, max: 100000, default: 10, label: 'الحد الأدنى للجملة' },
  cost_price: { type: 'number', min: 0, max: 1e7, default: 0, label: 'سعر التكلفة' },
  stock: { type: 'int', min: 0, max: 1e7, default: 0, label: 'المخزون' },
  low_stock_threshold: { type: 'int', min: 0, max: 100000, default: 3, label: 'حد التنبيه' },
  active: { type: 'bool', default: true },
  featured: { type: 'bool', default: false },
  badge: { type: 'string', max: 30, label: 'الشارة' },
};

function checkProductLogic(d) {
  if (d.compare_at_price != null && d.compare_at_price > 0 && d.compare_at_price <= d.price) throw new HttpError(400, 'السعر قبل الخصم يجب أن يكون أكبر من سعر البيع');
  if (d.wholesale_price != null && d.wholesale_price > 0 && d.wholesale_price >= d.price) throw new HttpError(400, 'سعر الجملة يجب أن يكون أقل من سعر القطاعي');
  if (d.category_id && !get('SELECT id FROM categories WHERE id = ?', d.category_id)) throw new HttpError(400, 'القسم غير موجود');
}
function nextSku() {
  const r = get("SELECT sku FROM products WHERE sku LIKE 'KA-%' ORDER BY CAST(SUBSTR(sku, 4) AS INTEGER) DESC LIMIT 1");
  const n = r ? parseInt(r.sku.slice(3), 10) || 1000 : 1000;
  return `KA-${n + 1}`;
}

function adminProduct(id) {
  const p = get(`SELECT p.*, c.name AS category_name, (SELECT name FROM categories WHERE id = c.parent_id) AS parent_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, id);
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  delete p.search_text;
  p.images = all('SELECT pi.media_id, pi.sort_order FROM product_images pi WHERE product_id = ? ORDER BY sort_order, id', id).map((r) => r.media_id);
  p.movements = all('SELECT sm.*, a.name AS admin_name FROM stock_movements sm LEFT JOIN admins a ON a.id = sm.admin_id WHERE product_id = ? ORDER BY sm.id DESC LIMIT 30', id);
  p.availability = store.availability(p);
  return p;
}

// --- images ---
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  return null;
}
function saveMedia(b) {
  const data = Buffer.from(String(b.data || ''), 'base64');
  if (!data.length) throw new HttpError(400, 'لم يتم إرسال صورة');
  if (data.length > 4 * 1024 * 1024) throw new HttpError(413, 'حجم الصورة كبير جداً (الحد 4MB)');
  const mime = sniffImage(data);
  if (!mime) throw new HttpError(400, 'صيغة الصورة غير مدعومة (JPG, PNG, WEBP فقط)');
  let thumb = null;
  if (b.thumb) {
    thumb = Buffer.from(String(b.thumb), 'base64');
    if (sniffImage(thumb) !== mime || thumb.length > 1024 * 1024) thumb = null;
  }
  const w = Number.isInteger(b.width) ? b.width : null; const h = Number.isInteger(b.height) ? b.height : null;
  const r = run('INSERT INTO media(data, thumb, mime, width, height, size) VALUES(?,?,?,?,?,?)', data, thumb, mime, w, h, data.length);
  return Number(r.lastInsertRowid);
}
function deleteMediaIfUnused(id) {
  if (!id) return;
  const used = get('SELECT (SELECT COUNT(*) FROM product_images WHERE media_id = ?) + (SELECT COUNT(*) FROM banners WHERE media_id = ?) AS n', id, id).n;
  const isLogo = getSettings().logo_media_id === id;
  if (!used && !isLogo) run('DELETE FROM media WHERE id = ?', id);
}

// --- CSV ---
function csvEscape(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function toCsv(rows, cols) { return '﻿' + [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map((c) => csvEscape(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\r\n'); }
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' && false) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
const PRODUCT_CSV_COLS = [
  ['sku', 'sku'], ['name', 'name'], ['category_name', 'category'], ['brand', 'brand'], ['price', 'price'], ['compare_at_price', 'compare_at_price'],
  ['wholesale_price', 'wholesale_price'], ['wholesale_min_qty', 'wholesale_min_qty'], ['cost_price', 'cost_price'], ['stock', 'stock'],
  ['active', 'active'], ['featured', 'featured'], ['badge', 'badge'], ['tags', 'tags'], ['short_description', 'short_description'], ['description', 'description'],
];

function dateRange(q) {
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : new Date(Date.now() - 29 * 864e5 + 2 * 3600e3).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : today;
  const fromIso = new Date(`${from}T00:00:00${TZ_OFFSET}`).toISOString();
  const toIso = new Date(new Date(`${to}T00:00:00${TZ_OFFSET}`).getTime() + 864e5).toISOString();
  return { from, to, fromIso, toIso };
}
function salesSummary(fromIso, toIso) {
  const r = get(`SELECT COUNT(*) AS orders,
    SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS valid_orders,
    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
    COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END), 0) AS revenue,
    COALESCE(SUM(CASE WHEN status != 'cancelled' THEN subtotal - discount END), 0) AS net_sales,
    COALESCE(SUM(CASE WHEN status != 'cancelled' THEN shipping_fee END), 0) AS shipping,
    COALESCE(SUM(CASE WHEN status != 'cancelled' THEN discount END), 0) AS discounts,
    COALESCE(SUM(CASE WHEN status != 'cancelled' THEN cost_total END), 0) AS cost,
    COALESCE(SUM(CASE WHEN status = 'completed' THEN subtotal - discount - cost_total END), 0) AS realized_profit
    FROM orders WHERE created_at >= ? AND created_at < ?`, fromIso, toIso);
  r.profit = round2(r.net_sales - r.cost);
  r.avg_order = r.valid_orders ? round2(r.revenue / r.valid_orders) : 0;
  r.items_sold = get(`SELECT COALESCE(SUM(oi.qty),0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ?`, fromIso, toIso).n;
  for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = round2(r[k]);
  return r;
}
function dailySeries(fromIso, toIso) {
  return all(`SELECT date(created_at, '+2 hours') AS day, COUNT(*) AS orders, ROUND(SUM(total), 2) AS revenue, ROUND(SUM(subtotal - discount - cost_total), 2) AS profit
    FROM orders WHERE status != 'cancelled' AND created_at >= ? AND created_at < ? GROUP BY day ORDER BY day`, fromIso, toIso);
}

function register(r) {
  // ---------- auth ----------
  r.post('/api/admin/login', async (req, res) => {
    csrfCheck(req);
    const b = await jsonBody(req, 8 * 1024);
    const ip = clientIp(req);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const rl1 = auth.rateLimit('login-ip:' + ip, 10, 15 * 60e3);
    const rl2 = auth.rateLimit('login-email:' + email, 6, 15 * 60e3);
    if (!rl1.ok || !rl2.ok) throw new HttpError(429, `محاولات دخول كثيرة. حاول بعد ${Math.ceil(Math.max(rl1.retryAfter, rl2.retryAfter) / 60)} دقيقة`);
    const admin = auth.login(email, String(b.password || '').slice(0, 200));
    if (!admin) { console.warn(`[auth] failed login for ${email} from ${ip}`); throw new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة'); }
    auth.setSessionCookie(req, res, admin);
    sendJson(req, res, 200, { id: admin.id, name: admin.name, email: admin.email, role: admin.role });
  });
  r.post('/api/admin/logout', (req, res) => { auth.clearSessionCookie(req, res); sendJson(req, res, 200, { ok: true }); });
  r.get('/api/admin/me', A((req, res, p, a) => sendJson(req, res, 200, { id: a.id, name: a.name, email: a.email, role: a.role, store_name: getSettings().store_name })));
  r.post('/api/admin/password', A(async (req, res, p, a) => {
    const b = await jsonBody(req);
    const d = validate(b, { current: { type: 'string', required: true, label: 'كلمة المرور الحالية', trim: false }, next: { type: 'string', required: true, min: 10, max: 200, label: 'كلمة المرور الجديدة', trim: false } });
    const row = get('SELECT * FROM admins WHERE id = ?', a.id);
    if (!auth.verifyPassword(d.current, row.password_hash)) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
    run('UPDATE admins SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', auth.hashPassword(d.next), a.id);
    auth.setSessionCookie(req, res, get('SELECT * FROM admins WHERE id = ?', a.id));
    sendJson(req, res, 200, { ok: true });
  }));

  // ---------- dashboard ----------
  r.get('/api/admin/dashboard', A((req, res) => {
    const now = Date.now();
    const dayStart = new Date(new Date(now + 2 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00' + TZ_OFFSET).toISOString();
    const end = new Date(now + 864e5).toISOString();
    sendJson(req, res, 200, {
      today: salesSummary(dayStart, end),
      week: salesSummary(new Date(now - 7 * 864e5).toISOString(), end),
      month: salesSummary(new Date(now - 30 * 864e5).toISOString(), end),
      series: dailySeries(new Date(now - 13 * 864e5).toISOString(), end),
      status_counts: all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status'),
      new_orders: get("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").n,
      unread_messages: get('SELECT COUNT(*) AS n FROM messages WHERE is_read = 0').n,
      products: get('SELECT COUNT(*) AS total, SUM(active) AS active, SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) AS out_of_stock, SUM(CASE WHEN stock > 0 AND stock <= low_stock_threshold THEN 1 ELSE 0 END) AS low_stock, COALESCE(SUM(stock * cost_price),0) AS stock_value, COALESCE(SUM(stock * price),0) AS stock_retail FROM products'),
      customers: get('SELECT COUNT(*) AS n FROM customers').n,
      low_stock: all('SELECT id, name, sku, stock, low_stock_threshold FROM products WHERE active = 1 AND stock <= low_stock_threshold ORDER BY stock ASC LIMIT 10'),
      recent_orders: all('SELECT id, number, customer_name, phone, total, status, created_at FROM orders ORDER BY id DESC LIMIT 8').map((o) => ({ ...o, status_label: STATUS[o.status] })),
      settings_incomplete: !getSettings().whatsapp,
    });
  }));

  // ---------- products ----------
  r.get('/api/admin/products', A((req, res) => {
    const q = req.query; const where = []; const params = [];
    if (q.q) {
      for (const t of normalizeAr(q.q).split(' ').filter(Boolean).slice(0, 6)) { where.push('p.search_text LIKE ?'); params.push(`%${t}%`); }
    }
    if (q.category) { where.push('(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))'); params.push(Number(q.category), Number(q.category)); }
    if (q.status === 'active') where.push('p.active = 1');
    if (q.status === 'inactive') where.push('p.active = 0');
    if (q.status === 'out') where.push('p.stock <= 0');
    if (q.status === 'low') where.push('p.stock > 0 AND p.stock <= p.low_stock_threshold');
    if (q.status === 'featured') where.push('p.featured = 1');
    if (q.status === 'sale') where.push('p.compare_at_price > p.price');
    if (q.status === 'noprice') where.push('p.price <= 0');
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sorts = { newest: 'p.id DESC', name: 'p.name', 'stock-asc': 'p.stock ASC', 'price-desc': 'p.price DESC', sold: 'p.sold_count DESC' };
    const per = 50; const total = get(`SELECT COUNT(*) AS n FROM products p ${w}`, ...params).n;
    const page = Math.max(1, Number(q.page) || 1);
    const items = all(`SELECT p.id, p.name, p.slug, p.sku, p.price, p.brand, (SELECT name FROM categories WHERE id = c.parent_id) AS parent_name, p.compare_at_price, p.wholesale_price, p.wholesale_min_qty, p.cost_price, p.stock, p.low_stock_threshold, p.active, p.featured, p.badge, p.sold_count, p.category_id, c.name AS category_name,
      (SELECT media_id FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_id
      FROM products p LEFT JOIN categories c ON c.id = p.category_id ${w} ORDER BY ${sorts[q.sort] || sorts.newest} LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per);
    sendJson(req, res, 200, { items, total, page, pages: Math.max(1, Math.ceil(total / per)) });
  }));
  r.get('/api/admin/products/next-sku', A((req, res) => sendJson(req, res, 200, { sku: nextSku() })));
  r.get('/api/admin/products.csv', A((req, res) => {
    const rows = all(`SELECT p.*, CASE WHEN c.parent_id IS NULL THEN c.name ELSE (SELECT name FROM categories WHERE id = c.parent_id) || ' > ' || c.name END AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id`);
    send(req, res, 200, toCsv(rows, PRODUCT_CSV_COLS), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
  }));
  r.post('/api/admin/products/import', A(async (req, res, p, a) => {
    const b = await jsonBody(req, 5 * 1024 * 1024);
    const rows = parseCsv(b.csv || '');
    if (rows.length < 2) throw new HttpError(400, 'الملف فارغ أو لا يحتوي على صف العناوين');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    if (!head.includes('sku') && (!head.includes('name') || !head.includes('price'))) throw new HttpError(400, 'يجب أن يحتوي الملف على عمود sku (لتحديث منتجات موجودة) أو على الأعمدة name و price لإضافة منتجات جديدة');
    const result = { created: 0, updated: 0, errors: [] };
    tx(() => {
      rows.slice(1).forEach((cells, i) => {
        const o = {}; head.forEach((h, j) => { o[h] = (cells[j] ?? '').trim(); });
        try {
          let catId = null;
          if (o.category) {
            const [pn, sn] = o.category.split('>').map((x) => x.trim());
            let par = get('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL', pn);
            if (!par) par = { id: Number(run('INSERT INTO categories(name, slug, icon, sort_order) VALUES(?,?,?,?)', pn, uniqueSlug('categories', pn), '📦', 99).lastInsertRowid) };
            catId = par.id;
            if (sn) {
              const sub = get('SELECT id FROM categories WHERE name = ? AND parent_id = ?', sn, par.id);
              catId = sub ? sub.id : Number(run('INSERT INTO categories(name, slug, icon, sort_order, parent_id) VALUES(?,?,?,?,?)', sn, uniqueSlug('categories', sn), '📦', 99, par.id).lastInsertRowid);
            }
          }
          const prev = o.sku ? get('SELECT * FROM products WHERE sku = ?', o.sku) : null;
          if (prev) { for (const k of ['name', 'price', 'stock', 'wholesale_min_qty', 'cost_price']) if (!(k in o) || o[k] === '') o[k] = prev[k]; if (!o.category) catId = prev.category_id; if (!('active' in o)) o.active = prev.active; if (!('featured' in o)) o.featured = prev.featured; }
          const d = validate({ ...o, category_id: catId, active: o.active === '' || o.active === undefined ? true : o.active, featured: o.featured }, PRODUCT_SCHEMA);
          checkProductLogic(d);
          const existing = d.sku ? get('SELECT id, stock FROM products WHERE sku = ?', d.sku) : null;
          if (existing) {
            // update only the columns present in the file (a price sheet won't wipe names, brands or descriptions)
            const colMap = { name: 'name', category: 'category_id', brand: 'brand', tags: 'tags', short_description: 'short_description', description: 'description', price: 'price', compare_at_price: 'compare_at_price', wholesale_price: 'wholesale_price', wholesale_min_qty: 'wholesale_min_qty', cost_price: 'cost_price', stock: 'stock', active: 'active', featured: 'featured', badge: 'badge' };
            const sets = []; const vals = [];
            for (const [h, col] of Object.entries(colMap)) if (head.includes(h)) { sets.push(`${col} = ?`); const v = d[col]; vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v); }
            run(`UPDATE products SET ${sets.join(', ')}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, ...vals, existing.id);
            if (!head.includes('stock')) d.stock = existing.stock;
            if (d.stock !== existing.stock) run('INSERT INTO stock_movements(product_id, change, stock_after, reason, admin_id) VALUES(?,?,?,?,?)', existing.id, d.stock - existing.stock, d.stock, 'استيراد CSV', a.id);
            refreshSearchText(existing.id); result.updated++;
          } else {
            const id = Number(run(`INSERT INTO products(name, slug, sku, category_id, brand, tags, short_description, description, price, compare_at_price, wholesale_price, wholesale_min_qty, cost_price, stock, active, featured, badge)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, d.name, uniqueSlug('products', d.name), d.sku || nextSku(), d.category_id, d.brand, d.tags, d.short_description, d.description, d.price, d.compare_at_price, d.wholesale_price, d.wholesale_min_qty, d.cost_price, d.stock, d.active ? 1 : 0, d.featured ? 1 : 0, d.badge).lastInsertRowid);
            if (d.stock) run('INSERT INTO stock_movements(product_id, change, stock_after, reason, admin_id) VALUES(?,?,?,?,?)', id, d.stock, d.stock, 'استيراد CSV', a.id);
            refreshSearchText(id); result.created++;
          }
        } catch (e) {
          result.errors.push(`سطر ${i + 2}: ${e.errors ? Object.values(e.errors)[0] : e.message}`);
        }
      });
    });
    sendJson(req, res, 200, result);
  }));
  r.post('/api/admin/products/bulk', A(async (req, res) => {
    const b = await jsonBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
    if (!ids.length) throw new HttpError(400, 'لم يتم تحديد منتجات');
    const ph = ids.map(() => '?').join(',');
    const actions = {
      activate: `UPDATE products SET active = 1 WHERE id IN (${ph})`, deactivate: `UPDATE products SET active = 0 WHERE id IN (${ph})`,
      feature: `UPDATE products SET featured = 1 WHERE id IN (${ph})`, unfeature: `UPDATE products SET featured = 0 WHERE id IN (${ph})`,
      delete: `DELETE FROM products WHERE id IN (${ph})`,
    };
    if (b.action === 'category') {
      const cid = b.category_id ? Number(b.category_id) : null;
      if (cid && !get('SELECT id FROM categories WHERE id = ?', cid)) throw new HttpError(400, 'القسم غير موجود');
      tx(() => { run(`UPDATE products SET category_id = ? WHERE id IN (${ph})`, cid, ...ids); ids.forEach(refreshSearchText); });
    } else if (actions[b.action]) {
      tx(() => {
        if (b.action === 'delete') {
          const media = all(`SELECT media_id FROM product_images WHERE product_id IN (${ph})`, ...ids).map((x) => x.media_id);
          run(actions.delete, ...ids); media.forEach(deleteMediaIfUnused);
        } else run(actions[b.action], ...ids);
      });
    } else throw new HttpError(400, 'إجراء غير معروف');
    sendJson(req, res, 200, { ok: true, count: ids.length });
  }));
  r.get('/api/admin/products/:id', A((req, res, p) => sendJson(req, res, 200, adminProduct(Number(p.id)))));
  r.post('/api/admin/products', A(async (req, res, p, a) => {
    const d = validate(await jsonBody(req), PRODUCT_SCHEMA);
    checkProductLogic(d);
    d.sku = d.sku || nextSku();
    if (get('SELECT id FROM products WHERE sku = ?', d.sku)) throw new HttpError(409, 'رقم SKU مستخدم لمنتج آخر');
    const id = tx(() => {
      const id = Number(run(`INSERT INTO products(name, slug, sku, category_id, brand, tags, short_description, description, price, compare_at_price, wholesale_price, wholesale_min_qty, cost_price, stock, low_stock_threshold, active, featured, badge)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, d.name, uniqueSlug('products', d.slug || d.name), d.sku, d.category_id, d.brand, d.tags, d.short_description, d.description,
        d.price, d.compare_at_price || null, d.wholesale_price || null, d.wholesale_min_qty, d.cost_price, d.stock, d.low_stock_threshold, d.active ? 1 : 0, d.featured ? 1 : 0, d.badge).lastInsertRowid);
      if (d.stock) run('INSERT INTO stock_movements(product_id, change, stock_after, reason, admin_id) VALUES(?,?,?,?,?)', id, d.stock, d.stock, 'رصيد افتتاحي', a.id);
      refreshSearchText(id);
      return id;
    });
    sendJson(req, res, 201, adminProduct(id));
  }));
  r.put('/api/admin/products/:id', A(async (req, res, p, a) => {
    const id = Number(p.id);
    const cur = get('SELECT * FROM products WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'المنتج غير موجود');
    const d = validate(await jsonBody(req), PRODUCT_SCHEMA);
    checkProductLogic(d);
    d.sku = d.sku || cur.sku;
    if (get('SELECT id FROM products WHERE sku = ? AND id != ?', d.sku, id)) throw new HttpError(409, 'رقم SKU مستخدم لمنتج آخر');
    tx(() => {
      const slug = d.slug && slugify(d.slug) !== cur.slug ? uniqueSlug('products', d.slug, id) : cur.slug;
      run(`UPDATE products SET name=?, slug=?, sku=?, category_id=?, brand=?, tags=?, short_description=?, description=?, price=?, compare_at_price=?, wholesale_price=?, wholesale_min_qty=?, cost_price=?, stock=?, low_stock_threshold=?, active=?, featured=?, badge=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
        d.name, slug, d.sku, d.category_id, d.brand, d.tags, d.short_description, d.description, d.price, d.compare_at_price || null, d.wholesale_price || null, d.wholesale_min_qty,
        d.cost_price, d.stock, d.low_stock_threshold, d.active ? 1 : 0, d.featured ? 1 : 0, d.badge, id);
      if (d.stock !== cur.stock) run('INSERT INTO stock_movements(product_id, change, stock_after, reason, admin_id) VALUES(?,?,?,?,?)', id, d.stock - cur.stock, d.stock, 'تعديل من صفحة المنتج', a.id);
      refreshSearchText(id);
    });
    sendJson(req, res, 200, adminProduct(id));
  }));
  // quick inline edits from the products table
  r.patch('/api/admin/products/:id', A(async (req, res, p, a) => {
    const id = Number(p.id);
    const cur = get('SELECT * FROM products WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'المنتج غير موجود');
    const b = await jsonBody(req);
    const allowed = ['price', 'wholesale_price', 'cost_price', 'stock', 'active', 'featured'];
    const sub = {}; for (const k of allowed) if (k in b) sub[k] = PRODUCT_SCHEMA[k];
    const d = validate(b, sub);
    const merged = { ...cur, ...d };
    checkProductLogic(merged);
    tx(() => {
      for (const [k, v] of Object.entries(d)) run(`UPDATE products SET ${k} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, typeof v === 'boolean' ? (v ? 1 : 0) : v, id);
      if ('stock' in d && d.stock !== cur.stock) run('INSERT INTO stock_movements(product_id, change, stock_after, reason, admin_id) VALUES(?,?,?,?,?)', id, d.stock - cur.stock, d.stock, 'تعديل سريع', a.id);
    });
    sendJson(req, res, 200, adminProduct(id));
  }));
  r.delete('/api/admin/products/:id', A((req, res, p) => {
    const id = Number(p.id);
    const media = all('SELECT media_id FROM product_images WHERE product_id = ?', id).map((x) => x.media_id);
    const r2 = run('DELETE FROM products WHERE id = ?', id);
    if (!Number(r2.changes)) throw new HttpError(404, 'المنتج غير موجود');
    media.forEach(deleteMediaIfUnused);
    sendJson(req, res, 200, { ok: true });
  }));
  r.post('/api/admin/products/:id/duplicate', A((req, res, p) => {
    const src = get('SELECT * FROM products WHERE id = ?', Number(p.id));
    if (!src) throw new HttpError(404, 'المنتج غير موجود');
    const id = tx(() => {
      const name = src.name + ' (نسخة)';
      const nid = Number(run(`INSERT INTO products(name, slug, sku, category_id, brand, tags, short_description, description, price, compare_at_price, wholesale_price, wholesale_min_qty, cost_price, stock, low_stock_threshold, active, featured, badge)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,0,0,?)`, name, uniqueSlug('products', name), nextSku(), src.category_id, src.brand, src.tags, src.short_description, src.description, src.price, src.compare_at_price, src.wholesale_price, src.wholesale_min_qty, src.cost_price, src.low_stock_threshold, src.badge).lastInsertRowid);
      refreshSearchText(nid);
      return nid;
    });
    sendJson(req, res, 201, adminProduct(id));
  }));
  r.post('/api/admin/products/:id/stock', A(async (req, res, p, a) => {
    const d = validate(await jsonBody(req), { change: { type: 'int', required: true, min: -1e6, max: 1e6, label: 'الكمية' }, reason: { type: 'string', max: 120, default: 'تعديل يدوي' } });
    if (d.change === 0) throw new HttpError(400, 'أدخل كمية غير صفرية');
    store.adjustStock(Number(p.id), d.change, d.reason, a.id);
    sendJson(req, res, 200, adminProduct(Number(p.id)));
  }));
  r.post('/api/admin/products/:id/images', A(async (req, res, p) => {
    const id = Number(p.id);
    if (!get('SELECT id FROM products WHERE id = ?', id)) throw new HttpError(404, 'المنتج غير موجود');
    if (get('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', id).n >= 12) throw new HttpError(400, 'الحد الأقصى 12 صورة للمنتج');
    const b = await jsonBody(req, 7 * 1024 * 1024);
    tx(() => {
      const mid = saveMedia(b);
      const max = get('SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_images WHERE product_id = ?', id).m;
      run('INSERT INTO product_images(product_id, media_id, sort_order) VALUES(?,?,?)', id, mid, max + 1);
      run("UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", id);
    });
    sendJson(req, res, 201, adminProduct(id));
  }));
  r.put('/api/admin/products/:id/images', A(async (req, res, p) => {
    const id = Number(p.id); const b = await jsonBody(req);
    const order = (Array.isArray(b.order) ? b.order : []).map(Number);
    tx(() => order.forEach((mid, i) => run('UPDATE product_images SET sort_order = ? WHERE product_id = ? AND media_id = ?', i, id, mid)));
    sendJson(req, res, 200, adminProduct(id));
  }));
  r.delete('/api/admin/products/:id/images/:mid', A((req, res, p) => {
    const id = Number(p.id); const mid = Number(p.mid);
    run('DELETE FROM product_images WHERE product_id = ? AND media_id = ?', id, mid);
    deleteMediaIfUnused(mid);
    sendJson(req, res, 200, adminProduct(id));
  }));
  r.get('/api/admin/inventory', A((req, res) => {
    sendJson(req, res, 200, { items: all('SELECT sm.*, p.name, p.sku, a.name AS admin_name FROM stock_movements sm JOIN products p ON p.id = sm.product_id LEFT JOIN admins a ON a.id = sm.admin_id ORDER BY sm.id DESC LIMIT 200') });
  }));

  // ---------- media (banners / logo) ----------
  r.post('/api/admin/media', A(async (req, res) => {
    const b = await jsonBody(req, 7 * 1024 * 1024);
    sendJson(req, res, 201, { id: saveMedia(b) });
  }));

  // ---------- categories ----------
  const CAT_SCHEMA = {
    name: { type: 'string', required: true, min: 2, max: 60, label: 'اسم القسم' }, icon: { type: 'string', max: 8, label: 'الأيقونة' },
    description: { type: 'string', max: 200, label: 'الوصف' }, sort_order: { type: 'int', min: 0, max: 9999, default: 0 }, active: { type: 'bool', default: true },
    slug: { type: 'string', max: 80 }, parent_id: { type: 'int', min: 1 },
  };
  const checkParent = (d, id) => {
    if (!d.parent_id) return;
    if (d.parent_id === id) throw new HttpError(400, 'لا يمكن أن يكون القسم فرعاً من نفسه');
    const par = get('SELECT * FROM categories WHERE id = ?', d.parent_id);
    if (!par) throw new HttpError(400, 'القسم الرئيسي غير موجود');
    if (par.parent_id) throw new HttpError(400, 'اختر قسماً رئيسياً (مستويان فقط)');
    if (id && get('SELECT 1 AS x FROM categories WHERE parent_id = ?', id)) throw new HttpError(400, 'هذا القسم فيه أقسام فرعية، لا يمكن جعله فرعياً');
  };
  r.get('/api/admin/categories', A((req, res) => {
    const rows = store.categoriesWithCounts(true).map(({ children, ...c }) => ({ ...c, total_products: get('SELECT COUNT(*) AS n FROM products WHERE category_id = ? OR category_id IN (SELECT id FROM categories WHERE parent_id = ?)', c.id, c.id).n }));
    // parents first, each followed by its subcategories
    const items = [];
    for (const p of rows.filter((c) => !c.parent_id)) { items.push(p); items.push(...rows.filter((c) => c.parent_id === p.id)); }
    sendJson(req, res, 200, { items });
  }));
  r.post('/api/admin/categories', A(async (req, res) => {
    const d = validate(await jsonBody(req), CAT_SCHEMA);
    checkParent(d);
    if (get('SELECT id FROM categories WHERE name = ? AND parent_id IS ?', d.name, d.parent_id)) throw new HttpError(409, 'يوجد قسم بنفس الاسم');
    const id = Number(run('INSERT INTO categories(name, slug, icon, description, sort_order, active, parent_id) VALUES(?,?,?,?,?,?,?)', d.name, uniqueSlug('categories', d.slug || d.name), d.icon || '📦', d.description, d.sort_order, d.active ? 1 : 0, d.parent_id).lastInsertRowid);
    sendJson(req, res, 201, get('SELECT * FROM categories WHERE id = ?', id));
  }));
  r.put('/api/admin/categories/:id', A(async (req, res, p) => {
    const id = Number(p.id); const cur = get('SELECT * FROM categories WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'القسم غير موجود');
    const d = validate(await jsonBody(req), CAT_SCHEMA);
    checkParent(d, id);
    if (get('SELECT id FROM categories WHERE name = ? AND parent_id IS ? AND id != ?', d.name, d.parent_id, id)) throw new HttpError(409, 'يوجد قسم بنفس الاسم');
    const slug = d.slug && slugify(d.slug) !== cur.slug ? uniqueSlug('categories', d.slug, id) : cur.slug;
    tx(() => {
      run('UPDATE categories SET name=?, slug=?, icon=?, description=?, sort_order=?, active=?, parent_id=? WHERE id=?', d.name, slug, d.icon || '📦', d.description, d.sort_order, d.active ? 1 : 0, d.parent_id, id);
      all('SELECT id FROM products WHERE category_id = ? OR category_id IN (SELECT id FROM categories WHERE parent_id = ?)', id, id).forEach((x) => refreshSearchText(x.id));
    });
    sendJson(req, res, 200, get('SELECT * FROM categories WHERE id = ?', id));
  }));
  r.delete('/api/admin/categories/:id', A((req, res, p) => {
    const r2 = run('DELETE FROM categories WHERE id = ?', Number(p.id));
    if (!Number(r2.changes)) throw new HttpError(404, 'القسم غير موجود');
    sendJson(req, res, 200, { ok: true });
  }));

  // ---------- orders ----------
  function orderFilters(q) {
    const where = []; const params = [];
    if (q.status && STATUS[q.status]) { where.push('o.status = ?'); params.push(q.status); }
    if (q.q) { where.push('(o.number LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ?)'); const t = `%${String(q.q).trim()}%`; params.push(t, t, `%${normalizePhone(q.q) || q.q}%`); }
    if (q.from || q.to) { const dr = dateRange(q); where.push('o.created_at >= ? AND o.created_at < ?'); params.push(dr.fromIso, dr.toIso); }
    if (q.customer) { where.push('o.customer_id = ?'); params.push(Number(q.customer)); }
    return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
  }
  r.get('/api/admin/orders', A((req, res) => {
    const { w, params } = orderFilters(req.query);
    const per = 30; const total = get(`SELECT COUNT(*) AS n FROM orders o ${w}`, ...params).n;
    const page = Math.max(1, Number(req.query.page) || 1);
    const items = all(`SELECT o.id, o.number, o.customer_name, o.phone, o.city, o.total, o.status, o.payment_label, o.created_at, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items
      FROM orders o ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per).map((o) => ({ ...o, status_label: STATUS[o.status] }));
    sendJson(req, res, 200, { items, total, page, pages: Math.max(1, Math.ceil(total / per)), counts: all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status') });
  }));
  r.get('/api/admin/orders.csv', A((req, res) => {
    const { w, params } = orderFilters(req.query);
    const rows = all(`SELECT o.*, (SELECT GROUP_CONCAT(name || ' x' || qty, ' | ') FROM order_items WHERE order_id = o.id) AS items_text FROM orders o ${w} ORDER BY o.id DESC`, ...params);
    const csv = toCsv(rows, [['number', 'رقم الطلب'], [(r) => new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Tripoli' }), 'التاريخ'], ['customer_name', 'العميل'], ['phone', 'الهاتف'], ['city', 'المنطقة'], ['address', 'العنوان'],
      [(r) => STATUS[r.status], 'الحالة'], ['payment_label', 'الدفع'], ['items_text', 'المنتجات'], ['subtotal', 'المجموع'], ['discount', 'الخصم'], ['shipping_fee', 'التوصيل'], ['total', 'الإجمالي'], ['cost_total', 'التكلفة'], [(r) => round2(r.subtotal - r.discount - r.cost_total), 'الربح'], ['coupon_code', 'الكوبون'], ['notes', 'ملاحظات العميل']]);
    send(req, res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
  }));
  r.get('/api/admin/orders/:id', A((req, res, p) => {
    const o = store.getOrder(Number(p.id));
    if (!o) throw new HttpError(404, 'الطلب غير موجود');
    o.transitions = store.TRANSITIONS[o.status];
    o.customer_orders = o.customer_id ? get('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', o.customer_id).n : 0;
    // link that opens a WhatsApp chat with the customer
    const ph = o.phone.startsWith('0') ? '218' + o.phone.slice(1) : o.phone;
    o.customer_whatsapp = `https://wa.me/${ph}?text=${encodeURIComponent(`مرحباً ${o.customer_name}، معك ${getSettings().store_name} بخصوص طلبك رقم ${o.number}.`)}`;
    sendJson(req, res, 200, o);
  }));
  r.post('/api/admin/orders/:id/status', A(async (req, res, p, a) => {
    const d = validate(await jsonBody(req), { status: { type: 'enum', required: true, values: Object.keys(STATUS), label: 'الحالة' }, note: { type: 'string', max: 300 } });
    const o = store.setOrderStatus(Number(p.id), d.status, d.note, a.id);
    o.transitions = store.TRANSITIONS[o.status];
    sendJson(req, res, 200, o);
  }));
  r.put('/api/admin/orders/:id/notes', A(async (req, res, p) => {
    const d = validate(await jsonBody(req), { admin_notes: { type: 'string', max: 2000 } });
    run("UPDATE orders SET admin_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", d.admin_notes, Number(p.id));
    sendJson(req, res, 200, { ok: true });
  }));
  r.delete('/api/admin/orders/:id', A((req, res, p) => {
    const o = get('SELECT status FROM orders WHERE id = ?', Number(p.id));
    if (!o) throw new HttpError(404, 'الطلب غير موجود');
    if (o.status !== 'cancelled') throw new HttpError(400, 'يجب إلغاء الطلب أولاً قبل حذفه نهائياً');
    run('DELETE FROM orders WHERE id = ?', Number(p.id));
    sendJson(req, res, 200, { ok: true });
  }, 'owner'));

  // ---------- customers ----------
  r.get('/api/admin/customers', A((req, res) => {
    const q = req.query; const where = []; const params = [];
    if (q.q) { where.push('(c.name LIKE ? OR c.phone LIKE ?)'); params.push(`%${q.q}%`, `%${normalizePhone(q.q) || q.q}%`); }
    if (q.type) { where.push('c.type = ?'); params.push(q.type); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const per = 50; const total = get(`SELECT COUNT(*) AS n FROM customers c ${w}`, ...params).n;
    const page = Math.max(1, Number(q.page) || 1);
    const items = all(`SELECT c.*, COUNT(o.id) AS orders_count, COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END), 0) AS total_spent, MAX(o.created_at) AS last_order_at
      FROM customers c LEFT JOIN orders o ON o.customer_id = c.id ${w} GROUP BY c.id ORDER BY last_order_at DESC NULLS LAST, c.id DESC LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per);
    sendJson(req, res, 200, { items, total, page, pages: Math.max(1, Math.ceil(total / per)) });
  }));
  r.get('/api/admin/customers.csv', A((req, res) => {
    const rows = all(`SELECT c.*, COUNT(o.id) AS orders_count, COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END), 0) AS total_spent FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id ORDER BY c.id`);
    send(req, res, 200, toCsv(rows, [['name', 'الاسم'], ['phone', 'الهاتف'], ['city', 'المنطقة'], ['address', 'العنوان'], [(r) => (r.type === 'wholesale' ? 'تاجر جملة' : 'قطاعي'), 'النوع'], ['orders_count', 'عدد الطلبات'], ['total_spent', 'إجمالي المشتريات'], ['notes', 'ملاحظات']]),
      'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="customers.csv"', 'Cache-Control': 'no-store' });
  }));
  r.get('/api/admin/customers/:id', A((req, res, p) => {
    const c = get('SELECT * FROM customers WHERE id = ?', Number(p.id));
    if (!c) throw new HttpError(404, 'العميل غير موجود');
    c.orders = all('SELECT id, number, total, status, created_at FROM orders WHERE customer_id = ? ORDER BY id DESC', c.id).map((o) => ({ ...o, status_label: STATUS[o.status] }));
    c.total_spent = round2(c.orders.filter((o) => o.status !== 'cancelled').reduce((a2, o) => a2 + o.total, 0));
    sendJson(req, res, 200, c);
  }));
  r.put('/api/admin/customers/:id', A(async (req, res, p) => {
    const d = validate(await jsonBody(req), { name: { type: 'string', required: true, min: 2, max: 80, label: 'الاسم' }, city: { type: 'string', max: 120 }, address: { type: 'string', max: 300 }, type: { type: 'enum', values: ['retail', 'wholesale'], default: 'retail' }, notes: { type: 'string', max: 2000 } });
    run("UPDATE customers SET name=?, city=?, address=?, type=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", d.name, d.city, d.address, d.type, d.notes, Number(p.id));
    sendJson(req, res, 200, { ok: true });
  }));

  // ---------- coupons ----------
  const COUPON_SCHEMA = {
    code: { type: 'string', required: true, min: 3, max: 30, label: 'الكود', pattern: /^[A-Za-z0-9_-]+$/, patternMsg: 'الكود يقبل الأحرف الإنجليزية والأرقام و - _ فقط' },
    type: { type: 'enum', required: true, values: ['percent', 'fixed'], label: 'النوع' },
    value: { type: 'number', required: true, min: 0.01, max: 1e6, label: 'القيمة' },
    min_order: { type: 'number', min: 0, default: 0 }, max_discount: { type: 'number', min: 0 }, usage_limit: { type: 'int', min: 1 },
    starts_at: { type: 'string', max: 30 }, ends_at: { type: 'string', max: 30 }, active: { type: 'bool', default: true },
  };
  const couponDates = (d) => {
    if (d.type === 'percent' && d.value > 100) throw new HttpError(400, 'نسبة الخصم لا يمكن أن تتجاوز 100%');
    for (const k of ['starts_at', 'ends_at']) if (d[k]) {
      const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d[k]) ? `${d[k]}T${k === 'ends_at' ? '23:59:59' : '00:00:00'}${TZ_OFFSET}` : d[k]);
      if (isNaN(dt)) throw new HttpError(400, 'تاريخ غير صالح'); d[k] = dt.toISOString();
    }
  };
  r.get('/api/admin/coupons', A((req, res) => sendJson(req, res, 200, { items: all('SELECT c.*, (SELECT COALESCE(SUM(discount),0) FROM orders WHERE coupon_code = c.code AND status != \'cancelled\') AS total_discount FROM coupons c ORDER BY id DESC') })));
  r.post('/api/admin/coupons', A(async (req, res) => {
    const d = validate(await jsonBody(req), COUPON_SCHEMA); couponDates(d);
    d.code = d.code.toUpperCase();
    if (get('SELECT id FROM coupons WHERE code = ?', d.code)) throw new HttpError(409, 'الكود مستخدم مسبقاً');
    const id = Number(run('INSERT INTO coupons(code, type, value, min_order, max_discount, usage_limit, starts_at, ends_at, active) VALUES(?,?,?,?,?,?,?,?,?)', d.code, d.type, d.value, d.min_order, d.max_discount, d.usage_limit, d.starts_at, d.ends_at, d.active ? 1 : 0).lastInsertRowid);
    sendJson(req, res, 201, get('SELECT * FROM coupons WHERE id = ?', id));
  }));
  r.put('/api/admin/coupons/:id', A(async (req, res, p) => {
    const d = validate(await jsonBody(req), COUPON_SCHEMA); couponDates(d);
    d.code = d.code.toUpperCase();
    if (get('SELECT id FROM coupons WHERE code = ? AND id != ?', d.code, Number(p.id))) throw new HttpError(409, 'الكود مستخدم مسبقاً');
    run('UPDATE coupons SET code=?, type=?, value=?, min_order=?, max_discount=?, usage_limit=?, starts_at=?, ends_at=?, active=? WHERE id=?', d.code, d.type, d.value, d.min_order, d.max_discount, d.usage_limit, d.starts_at, d.ends_at, d.active ? 1 : 0, Number(p.id));
    sendJson(req, res, 200, get('SELECT * FROM coupons WHERE id = ?', Number(p.id)));
  }));
  r.delete('/api/admin/coupons/:id', A((req, res, p) => { run('DELETE FROM coupons WHERE id = ?', Number(p.id)); sendJson(req, res, 200, { ok: true }); }));

  // ---------- reports ----------
  r.get('/api/admin/reports', A((req, res) => {
    const dr = dateRange(req.query);
    const base = `FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ?`;
    sendJson(req, res, 200, {
      range: { from: dr.from, to: dr.to },
      summary: salesSummary(dr.fromIso, dr.toIso),
      series: dailySeries(dr.fromIso, dr.toIso),
      top_products: all(`SELECT oi.product_id, oi.name, oi.sku, SUM(oi.qty) AS qty, ROUND(SUM(oi.line_total),2) AS revenue, ROUND(SUM(oi.line_total - oi.cost_price * oi.qty),2) AS profit ${base} GROUP BY COALESCE(oi.product_id, oi.name) ORDER BY revenue DESC LIMIT 15`, dr.fromIso, dr.toIso),
      by_category: all(`SELECT COALESCE(c.name, 'بدون قسم') AS name, SUM(oi.qty) AS qty, ROUND(SUM(oi.line_total),2) AS revenue, ROUND(SUM(oi.line_total - oi.cost_price * oi.qty),2) AS profit ${base.replace('WHERE', 'LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE')} GROUP BY c.id ORDER BY revenue DESC`, dr.fromIso, dr.toIso),
      by_price_type: all(`SELECT oi.price_type, SUM(oi.qty) AS qty, ROUND(SUM(oi.line_total),2) AS revenue ${base} GROUP BY oi.price_type`, dr.fromIso, dr.toIso),
      by_payment: all(`SELECT payment_label AS name, COUNT(*) AS orders, ROUND(SUM(total),2) AS revenue FROM orders WHERE status != 'cancelled' AND created_at >= ? AND created_at < ? GROUP BY payment_method ORDER BY revenue DESC`, dr.fromIso, dr.toIso),
      by_zone: all(`SELECT city AS name, COUNT(*) AS orders, ROUND(SUM(total),2) AS revenue FROM orders WHERE status != 'cancelled' AND created_at >= ? AND created_at < ? GROUP BY city ORDER BY orders DESC`, dr.fromIso, dr.toIso),
      by_status: all('SELECT status, COUNT(*) AS n, ROUND(SUM(total),2) AS total FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status', dr.fromIso, dr.toIso).map((x) => ({ ...x, label: STATUS[x.status] })),
      coupons: all(`SELECT coupon_code AS code, COUNT(*) AS orders, ROUND(SUM(discount),2) AS discount FROM orders WHERE coupon_code IS NOT NULL AND status != 'cancelled' AND created_at >= ? AND created_at < ? GROUP BY coupon_code`, dr.fromIso, dr.toIso),
    });
  }));

  // ---------- banners ----------
  const BANNER_SCHEMA = {
    title: { type: 'string', required: true, min: 2, max: 120, label: 'العنوان' }, subtitle: { type: 'string', max: 300 }, cta_text: { type: 'string', max: 40 },
    link: { type: 'string', max: 300, pattern: /^(\/|https?:\/\/)/, patternMsg: 'الرابط يجب أن يبدأ بـ / أو https://' },
    media_id: { type: 'int', min: 1 }, theme: { type: 'enum', values: ['navy', 'orange', 'teal', 'dark'], default: 'navy' },
    sort_order: { type: 'int', min: 0, default: 0 }, active: { type: 'bool', default: true },
  };
  r.get('/api/admin/banners', A((req, res) => sendJson(req, res, 200, { items: all('SELECT * FROM banners ORDER BY sort_order, id') })));
  r.post('/api/admin/banners', A(async (req, res) => {
    const d = validate(await jsonBody(req), BANNER_SCHEMA);
    const id = Number(run('INSERT INTO banners(title, subtitle, cta_text, link, media_id, theme, sort_order, active) VALUES(?,?,?,?,?,?,?,?)', d.title, d.subtitle, d.cta_text, d.link, d.media_id, d.theme, d.sort_order, d.active ? 1 : 0).lastInsertRowid);
    sendJson(req, res, 201, get('SELECT * FROM banners WHERE id = ?', id));
  }));
  r.put('/api/admin/banners/:id', A(async (req, res, p) => {
    const d = validate(await jsonBody(req), BANNER_SCHEMA);
    const cur = get('SELECT * FROM banners WHERE id = ?', Number(p.id));
    if (!cur) throw new HttpError(404, 'البانر غير موجود');
    run('UPDATE banners SET title=?, subtitle=?, cta_text=?, link=?, media_id=?, theme=?, sort_order=?, active=? WHERE id=?', d.title, d.subtitle, d.cta_text, d.link, d.media_id, d.theme, d.sort_order, d.active ? 1 : 0, cur.id);
    if (cur.media_id && cur.media_id !== d.media_id) deleteMediaIfUnused(cur.media_id);
    sendJson(req, res, 200, get('SELECT * FROM banners WHERE id = ?', cur.id));
  }));
  r.delete('/api/admin/banners/:id', A((req, res, p) => {
    const cur = get('SELECT * FROM banners WHERE id = ?', Number(p.id));
    run('DELETE FROM banners WHERE id = ?', Number(p.id));
    if (cur) deleteMediaIfUnused(cur.media_id);
    sendJson(req, res, 200, { ok: true });
  }));

  // ---------- pages ----------
  r.get('/api/admin/pages', A((req, res) => sendJson(req, res, 200, { items: all('SELECT * FROM pages ORDER BY slug') })));
  r.put('/api/admin/pages/:slug', A(async (req, res, p) => {
    const d = validate(await jsonBody(req), { title: { type: 'string', required: true, max: 120, label: 'العنوان' }, content: { type: 'string', required: true, max: 20000, label: 'المحتوى' } });
    const r2 = run("UPDATE pages SET title=?, content=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug=?", d.title, d.content, p.slug);
    if (!Number(r2.changes)) throw new HttpError(404, 'الصفحة غير موجودة');
    sendJson(req, res, 200, get('SELECT * FROM pages WHERE slug = ?', p.slug));
  }));

  // ---------- messages ----------
  r.get('/api/admin/messages', A((req, res) => sendJson(req, res, 200, { items: all('SELECT * FROM messages ORDER BY id DESC LIMIT 200') })));
  r.put('/api/admin/messages/:id/read', A((req, res, p) => { run('UPDATE messages SET is_read = 1 WHERE id = ?', Number(p.id)); sendJson(req, res, 200, { ok: true }); }));
  r.delete('/api/admin/messages/:id', A((req, res, p) => { run('DELETE FROM messages WHERE id = ?', Number(p.id)); sendJson(req, res, 200, { ok: true }); }));

  // ---------- settings (owner) ----------
  r.get('/api/admin/settings', A((req, res) => sendJson(req, res, 200, getSettings())));
  r.put('/api/admin/settings', A(async (req, res) => {
    const b = await jsonBody(req, 64 * 1024);
    const str = (max) => ({ type: 'string', max });
    const d = validate(b, {
      store_name: { type: 'string', required: true, min: 2, max: 60, label: 'اسم المتجر' }, tagline: str(120), topline: str(200), announcement: str(300),
      whatsapp: { type: 'string', max: 20, pattern: /^[0-9+\s-]*$/, patternMsg: 'رقم واتساب يقبل الأرقام فقط', label: 'واتساب' }, phone: str(30), email: str(120), address: str(200), working_hours: str(120),
      facebook: { type: 'string', max: 200, pattern: /^(https?:\/\/.*)?$/, patternMsg: 'رابط فيسبوك يجب أن يبدأ بـ https://' },
      instagram: { type: 'string', max: 200, pattern: /^(https?:\/\/.*)?$/, patternMsg: 'رابط إنستغرام يجب أن يبدأ بـ https://' },
      tiktok: { type: 'string', max: 200, pattern: /^(https?:\/\/.*)?$/, patternMsg: 'رابط تيك توك يجب أن يبدأ بـ https://' },
      site_url: { type: 'string', max: 200, pattern: /^(https?:\/\/[^\s]+)?$/, patternMsg: 'رابط الموقع يجب أن يبدأ بـ https://' },
      seo_description: str(300), wholesale_note: str(300),
      free_shipping_over: { type: 'number', min: 0, default: 0 },
      shipping_zones: { type: 'array', required: true, max: 50, label: 'مناطق التوصيل' },
      payment_methods: { type: 'array', required: true, max: 10, label: 'طرق الدفع' },
      logo_media_id: { type: 'int', min: 1 },
    });
    d.whatsapp = d.whatsapp ? d.whatsapp.replace(/\D/g, '') : '';
    d.shipping_zones = d.shipping_zones.map((z) => validate(z, { name: { type: 'string', required: true, max: 80, label: 'اسم المنطقة' }, fee: { type: 'number', required: true, min: 0, max: 10000, label: 'رسوم التوصيل' } }));
    if (!d.shipping_zones.length) throw new HttpError(400, 'أضف منطقة توصيل واحدة على الأقل');
    const ids = new Set(DEFAULT_SETTINGS.payment_methods.map((m) => m.id));
    d.payment_methods = d.payment_methods.map((m) => validate(m, { id: { type: 'string', required: true, max: 20, pattern: /^[a-z0-9_-]+$/ }, name: { type: 'string', required: true, max: 80, label: 'اسم طريقة الدفع' }, instructions: str(300), enabled: { type: 'bool' } }));
    if (!d.payment_methods.some((m) => m.enabled)) throw new HttpError(400, 'فعّل طريقة دفع واحدة على الأقل');
    void ids;
    const prevLogo = getSettings().logo_media_id;
    for (const [k, v] of Object.entries(d)) setSetting(k, v ?? '');
    if (prevLogo && prevLogo !== d.logo_media_id) deleteMediaIfUnused(prevLogo);
    sendJson(req, res, 200, getSettings());
  }, 'owner'));

  // ---------- admin users (owner) ----------
  r.get('/api/admin/users', A((req, res) => sendJson(req, res, 200, { items: all('SELECT id, name, email, role, active, last_login_at, created_at FROM admins ORDER BY id') }), 'owner'));
  r.post('/api/admin/users', A(async (req, res) => {
    const d = validate(await jsonBody(req), { name: { type: 'string', required: true, min: 2, max: 60, label: 'الاسم' }, email: { type: 'string', required: true, max: 120, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMsg: 'البريد الإلكتروني غير صالح' }, password: { type: 'string', required: true, min: 10, max: 200, trim: false, label: 'كلمة المرور' }, role: { type: 'enum', values: ['owner', 'staff'], default: 'staff' } });
    if (get('SELECT id FROM admins WHERE email = ?', d.email)) throw new HttpError(409, 'البريد الإلكتروني مستخدم');
    run('INSERT INTO admins(name, email, password_hash, role) VALUES(?,?,?,?)', d.name, d.email.toLowerCase(), auth.hashPassword(d.password), d.role);
    sendJson(req, res, 201, { ok: true });
  }, 'owner'));
  r.put('/api/admin/users/:id', A(async (req, res, p, a) => {
    const id = Number(p.id);
    const d = validate(await jsonBody(req), { name: { type: 'string', required: true, min: 2, max: 60 }, role: { type: 'enum', values: ['owner', 'staff'], required: true }, active: { type: 'bool' }, password: { type: 'string', min: 10, max: 200, trim: false, label: 'كلمة المرور' } });
    if (id === a.id && (d.role !== 'owner' || !d.active)) throw new HttpError(400, 'لا يمكنك إزالة صلاحياتك أو تعطيل حسابك');
    tx(() => {
      run('UPDATE admins SET name=?, role=?, active=?, token_version = token_version + CASE WHEN active != ? THEN 1 ELSE 0 END WHERE id=?', d.name, d.role, d.active ? 1 : 0, d.active ? 1 : 0, id);
      if (d.password) run('UPDATE admins SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', auth.hashPassword(d.password), id);
      if (!get("SELECT 1 AS x FROM admins WHERE role = 'owner' AND active = 1")) throw new HttpError(400, 'يجب أن يبقى مالك واحد نشط على الأقل');
    });
    sendJson(req, res, 200, { ok: true });
  }, 'owner'));
  r.delete('/api/admin/users/:id', A((req, res, p, a) => {
    if (Number(p.id) === a.id) throw new HttpError(400, 'لا يمكنك حذف حسابك');
    run('DELETE FROM admins WHERE id = ?', Number(p.id));
    sendJson(req, res, 200, { ok: true });
  }, 'owner'));

  // ---------- backup (owner) ----------
  r.get('/api/admin/backup', A((req, res) => {
    const tmp = path.join(os.tmpdir(), `ka-backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
    send(req, res, 200, buf, 'application/octet-stream', { 'Content-Disposition': `attachment; filename="khabar-store-backup-${new Date().toISOString().slice(0, 10)}.db"`, 'Cache-Control': 'no-store' });
  }, 'owner'));
}

module.exports = { register, parseCsv };
