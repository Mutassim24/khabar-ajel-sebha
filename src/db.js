'use strict';
// SQLite database (built into Node 22+ via node:sqlite). Schema, migrations, settings, seed data.
process.removeAllListeners('warning'); // silence the "experimental" warning for node:sqlite
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { normalizeAr, slugify } = require('./util');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'store.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  active INTEGER NOT NULL DEFAULT 1, token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, icon TEXT, description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  brand TEXT, tags TEXT, short_description TEXT, description TEXT,
  price REAL NOT NULL DEFAULT 0, compare_at_price REAL, wholesale_price REAL, wholesale_min_qty INTEGER NOT NULL DEFAULT 10,
  cost_price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, low_stock_threshold INTEGER NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0, badge TEXT,
  sold_count INTEGER NOT NULL DEFAULT 0, search_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id, active);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY, data BLOB NOT NULL, thumb BLOB, mime TEXT NOT NULL, width INTEGER, height INTEGER, size INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pimg ON product_images(product_id, sort_order);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, city TEXT, address TEXT,
  type TEXT NOT NULL DEFAULT 'retail', notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value REAL NOT NULL, min_order REAL NOT NULL DEFAULT 0, max_discount REAL, usage_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT, ends_at TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE, token TEXT NOT NULL, customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL, phone TEXT NOT NULL, city TEXT, address TEXT, notes TEXT,
  payment_method TEXT NOT NULL, payment_label TEXT, status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','processing','shipped','completed','cancelled')),
  subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, shipping_fee REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  cost_total REAL NOT NULL DEFAULT 0, coupon_code TEXT, admin_notes TEXT, ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, name TEXT NOT NULL, sku TEXT,
  unit_price REAL NOT NULL, cost_price REAL NOT NULL DEFAULT 0, qty INTEGER NOT NULL, price_type TEXT NOT NULL DEFAULT 'retail',
  line_total REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oi_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT, admin_id INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change INTEGER NOT NULL, stock_after INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT, admin_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sm_product ON stock_movements(product_id, created_at);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT, cta_text TEXT, link TEXT, media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  theme TEXT NOT NULL DEFAULT 'navy', sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, subject TEXT, body TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;
db.exec(SCHEMA);

// ---------- helpers ----------
const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}
const plain = (r) => (r ? { ...r } : r);
const all = (sql, ...p) => prep(sql).all(...p).map(plain);
const get = (sql, ...p) => plain(prep(sql).get(...p));
const run = (sql, ...p) => prep(sql).run(...p);
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  store_name: 'خبر عاجل سبها',
  tagline: 'إكسسوارات الهواتف المحمولة وقطع الغيار',
  topline: '🚚 توصيل داخل سبها وإلى جميع المدن الليبية · الدفع عند الاستلام · أسعار جملة للتجار',
  whatsapp: '218926201329',
  phone: '0926201329',
  email: '',
  address: 'سبها، ليبيا',
  working_hours: 'يومياً من 9 صباحاً حتى 11 مساءً',
  facebook: '', instagram: '', tiktok: '',
  site_url: '',
  seo_description: 'خبر عاجل سبها — متجر إكسسوارات الهواتف وقطع الغيار في سبها: شواحن، كابلات، سماعات، جرابات، واقيات شاشة، باور بانك، ساعات ذكية وأدوات صيانة. أسعار قطاعي وجملة وتوصيل لكل ليبيا.',
  free_shipping_over: 0,
  shipping_zones: [
    { name: 'سبها — داخل المدينة', fee: 10 },
    { name: 'استلام من المحل', fee: 0 },
    { name: 'مدن الجنوب (أوباري، مرزق، براك...)', fee: 25 },
    { name: 'طرابلس والمنطقة الغربية', fee: 35 },
    { name: 'بنغازي والمنطقة الشرقية', fee: 40 },
  ],
  payment_methods: [
    { id: 'cod', name: 'الدفع نقداً عند الاستلام', instructions: 'ادفع نقداً للمندوب عند استلام الطلب.', enabled: true },
    { id: 'bank', name: 'تحويل مصرفي', instructions: 'سيتواصل معك فريقنا لتزويدك ببيانات الحساب المصرفي، ويُجهَّز الطلب بعد تأكيد التحويل.', enabled: true },
    { id: 'wallet', name: 'محفظة إلكترونية (سداد / موبي كاش / تداول)', instructions: 'سنرسل لك رقم المحفظة عبر واتساب لإتمام الدفع.', enabled: true },
    { id: 'card', name: 'بطاقة مصرفية عند الاستلام (POS)', instructions: 'الدفع ببطاقة مصرفية محلية عبر جهاز نقاط البيع عند الاستلام (حسب توفره).', enabled: false },
  ],
  wholesale_note: 'لأصحاب المحلات والفنيين: يُطبَّق سعر الجملة تلقائياً عند الوصول للحد الأدنى من الكمية لكل منتج.',
  announcement: '',
};
function getSetting(key) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return DEFAULT_SETTINGS[key];
  try { return JSON.parse(r.value); } catch { return r.value; }
}
function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  settingsCache = null;
}
let settingsCache = null;
function getSettings() {
  if (settingsCache) return settingsCache;
  const s = { ...DEFAULT_SETTINGS };
  for (const r of all('SELECT key, value FROM settings')) {
    if (r.key.startsWith('_')) continue;
    try { s[r.key] = JSON.parse(r.value); } catch { s[r.key] = r.value; }
  }
  settingsCache = s;
  return s;
}

// Session secret: from env, otherwise generated once and stored (never sent to clients).
function sessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  let r = get("SELECT value FROM settings WHERE key = '_session_secret'");
  if (!r) {
    const v = crypto.randomBytes(48).toString('base64url');
    run("INSERT INTO settings(key, value) VALUES('_session_secret', ?)", JSON.stringify(v));
    return v;
  }
  return JSON.parse(r.value);
}

// ---------- migrations ----------
if (!all('PRAGMA table_info(categories)').some((c) => c.name === 'parent_id')) {
  db.exec('ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)');
const SEARCH_INDEX_VERSION = '3';

// ---------- product search text ----------
function buildSearchText(p, categoryName, parentName) {
  return ' ' + normalizeAr([p.name, p.brand, p.sku, p.tags, categoryName, parentName].filter(Boolean).join(' ')) + ' ';
}
function refreshSearchText(productId) {
  const p = get(`SELECT p.*, c.name AS category_name, (SELECT name FROM categories WHERE id = c.parent_id) AS parent_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, productId);
  if (p) run('UPDATE products SET search_text = ? WHERE id = ?', buildSearchText(p, p.category_name, p.parent_name), productId);
}
function reindexSearch() {
  const r = get("SELECT value FROM settings WHERE key = '_search_index'");
  if (r && JSON.parse(r.value) === SEARCH_INDEX_VERSION) return;
  for (const x of all('SELECT id FROM products')) refreshSearchText(x.id);
  run("INSERT INTO settings(key, value) VALUES('_search_index', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(SEARCH_INDEX_VERSION));
}
function uniqueSlug(table, base, excludeId) {
  let slug = slugify(base); let i = 2;
  while (get(`SELECT id FROM ${table} WHERE slug = ? AND id IS NOT ?`, slug, excludeId ?? null)) slug = `${slugify(base)}-${i++}`;
  return slug;
}

// ---------- seed ----------
const SEED_DIR = path.join(__dirname, '..', 'seed');
function loadCatalog() {
  try { return JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'catalog.json'), 'utf8')); } catch { return { taxonomy: [], products: [] }; }
}
/** Category id for [parent, sub] names (creates nothing). */
function categoryId(parentName, subName) {
  const parent = get('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL', parentName);
  if (!parent) return null;
  if (!subName) return parent.id;
  const sub = get('SELECT id FROM categories WHERE name = ? AND parent_id = ?', subName, parent.id);
  return sub ? sub.id : parent.id;
}
function seedTaxonomy(taxonomy) {
  taxonomy.forEach((c, i) => {
    let parent = get('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL', c.name);
    if (!parent) parent = { id: Number(run('INSERT INTO categories(name, slug, icon, description, sort_order) VALUES(?,?,?,?,?)', c.name, uniqueSlug('categories', c.name), c.icon, c.description, i).lastInsertRowid) };
    (c.subs || []).forEach(([name, desc], j) => {
      if (!get('SELECT id FROM categories WHERE name = ? AND parent_id = ?', name, parent.id)) {
        run('INSERT INTO categories(name, slug, icon, description, sort_order, parent_id) VALUES(?,?,?,?,?,?)', name, uniqueSlug('categories', name), c.icon, desc || null, j, parent.id);
      }
    });
  });
}
const FEATURED_MODELS = ['PQ30', 'P50', 'MX-HC326', '100W GaN', 'KL-96', 'D6DP', 'DL-1923', 'Tune 510BT'];
/** Import the shop's real products (photographed) with processed images. Prices start at 0 = "price on request". */
function seedCatalog(catalog, from = 0) {
  const imgDir = path.join(SEED_DIR, 'images');
  tx(() => {
    catalog.products.forEach((p, i) => {
      if (i < from) return;
      const sku = 'KA-' + String(2001 + i);
      if (get('SELECT id FROM products WHERE sku = ?', sku)) return;
      const desc = [p.short, '', '## المواصفات', ...(p.specs || []).map((x) => '- ' + x), '', '## الضمان والتوصيل', '- يُفحص المنتج قبل التسليم، واستبدال للعيوب المصنعية.', '- توصيل داخل سبها ولكل المدن الليبية، والدفع عند الاستلام.'].join('\n');
      const id = Number(run(`INSERT INTO products(name, slug, sku, category_id, brand, tags, short_description, description, price, stock, featured, active)
        VALUES(?,?,?,?,?,?,?,?,0,0,?,1)`, p.name, uniqueSlug('products', p.name), sku, categoryId(p.cat[0], p.cat[1]), p.brand || null,
        [p.tags, p.model].filter(Boolean).join(', '), p.short, desc, FEATURED_MODELS.includes(p.model) ? 1 : 0).lastInsertRowid);
      (p.images || []).forEach((file, k) => {
        const full = path.join(imgDir, file); if (!fs.existsSync(full)) return;
        const thumbFile = full.replace(/\.webp$/, '.thumb.webp');
        const data = fs.readFileSync(full); const thumb = fs.existsSync(thumbFile) ? fs.readFileSync(thumbFile) : null;
        const mid = Number(run('INSERT INTO media(data, thumb, mime, width, height, size) VALUES(?,?,?,?,?,?)', data, thumb, 'image/webp', 1200, 1200, data.length).lastInsertRowid);
        run('INSERT INTO product_images(product_id, media_id, sort_order) VALUES(?,?,?)', id, mid, k);
      });
      refreshSearchText(id);
    });
  });
}
const SEED_PAGES = {
  about: ['من نحن', `خبر عاجل سبها متجر متخصص في إكسسوارات الهواتف المحمولة وقطع الغيار وأدوات الصيانة، نخدم زبائننا في مدينة سبها وجميع المدن الليبية.

نوفر تشكيلة واسعة من الشواحن والكابلات والسماعات والجرابات وواقيات الشاشة والباور بانك والساعات الذكية، إضافة إلى قطع الغيار وأدوات الفنيين، بأسعار قطاعي للأفراد وأسعار جملة لأصحاب المحلات.

## لماذا نحن؟
- منتجات مختارة بعناية مع توضيح حالة كل منتج.
- أسعار واضحة بالدينار الليبي، وسعر جملة يُطبَّق تلقائياً عند الكميات.
- طلب سهل من الموقع أو عبر واتساب، والدفع عند الاستلام.
- خدمة ما بعد البيع ومتابعة لكل طلب برقم خاص.`],
  privacy: ['سياسة الخصوصية', `نحترم خصوصيتك ونلتزم بحماية بياناتك.

## البيانات التي نجمعها
عند إتمام الطلب نجمع: الاسم، رقم الهاتف، المدينة والعنوان، وأي ملاحظات تكتبها. نستخدم هذه البيانات فقط لتجهيز طلبك وتوصيله والتواصل معك بشأنه.

## مشاركة البيانات
لا نبيع بياناتك ولا نشاركها مع أي طرف ثالث، باستثناء شركة/مندوب التوصيل بالقدر اللازم لإيصال الطلب.

## التخزين المحلي
يحفظ الموقع سلة المشتريات وقائمة المفضلة في متصفحك فقط لتسهيل التسوق.

## التواصل
لأي استفسار حول بياناتك أو لطلب حذفها، تواصل معنا عبر صفحة اتصل بنا.`],
  shipping: ['الشحن والاستبدال', `## التوصيل
- داخل سبها: خلال 24 ساعة غالباً من تأكيد الطلب.
- باقي المدن الليبية: من 2 إلى 5 أيام عمل حسب المنطقة.
- تظهر رسوم التوصيل لكل منطقة في صفحة إتمام الطلب قبل التأكيد.

## الدفع
الدفع نقداً عند الاستلام متاح لجميع الطلبات، إضافة إلى التحويل المصرفي والمحافظ الإلكترونية.

## الاستبدال والإرجاع
- يمكن استبدال المنتج خلال 3 أيام من الاستلام إذا كان به عيب مصنعي، بشرط أن يكون بحالته الأصلية مع العلبة.
- لا يشمل الاستبدال سوء الاستخدام أو الكسر أو واقيات الشاشة بعد تركيبها.
- قطع الغيار تُفحص قبل التسليم، ويُستبدل غير المطابق منها خلال 24 ساعة قبل التركيب.
- للبدء في الاستبدال تواصل معنا عبر واتساب مع رقم الطلب.`],
  contact: ['اتصل بنا', `يسعدنا تواصلك معنا لأي استفسار عن المنتجات أو الطلبات أو أسعار الجملة.

راسلنا عبر واتساب أو اتصل بنا مباشرة، أو أرسل رسالتك من النموذج أدناه وسنرد عليك في أقرب وقت.`],
};
const SEED_BANNERS = [
  ['كل ما يحتاجه هاتفك في مكان واحد', 'شواحن، سماعات، جرابات، واقيات شاشة وقطع غيار — بأسعار قطاعي وجملة وتوصيل لكل ليبيا.', 'تسوّق الآن', '/shop', 'navy'],
  ['عروض الشحن السريع', 'شواحن وكابلات أصلية بخصومات خاصة لفترة محدودة.', 'شاهد العروض', '/shop?sale=1', 'orange'],
  ['أسعار جملة لأصحاب المحلات والفنيين', 'يُطبَّق سعر الجملة تلقائياً عند الوصول للكمية المحددة لكل منتج.', 'منتجات الجملة', '/shop?wholesale=1', 'teal'],
];
// Starter catalogue carried over from the original prototype (only seeded when SEED_SAMPLE_PRODUCTS=true).
const SAMPLE_PRODUCTS = [
  ['شاحن سريع Type-C بقوة 25W', ['الشواحن', 'شاحن كامل'], 45, 38, 30, 24, 'الأكثر طلباً', 55],
  ['كابل Type-C للشحن السريع 1 متر', ['الشواحن', 'وصلة (خيط شحن)'], 15, 10, 7, 50, '', null],
  ['جراب حماية شفاف مقاوم للصدمات', ['الكفرات'], 12, 8, 5, 30, 'جديد', null],
  ['واقي شاشة زجاج 9D', ['الحمايات', 'ضد كسر'], 10, 6, 3.5, 40, '', null],
  ['سماعة بلوتوث TWS', ['السماعات', 'ايربودز'], 65, 52, 40, 12, 'عرض', 80],
  ['باور بانك 10000mAh', ['باور بنك', '20 ألف وأقل'], 85, 70, 58, 10, '', null],
  ['حامل هاتف مغناطيسي للسيارة', ['إكسسوارات السيارة', 'حامل تلفون'], 25, 18, 12, 18, '', null],
  ['ساعة ذكية مع سوار رياضي', ['الساعات الذكية'], 120, 98, 80, 8, 'جديد', null],
  ['إضاءة Ring Light للتصوير 10 إنش', ['التصوير'], 55, 45, 34, 9, '', null],
  ['أزرار ألعاب PUBG للهاتف', ['ملحقات الألعاب', 'يد تحكم (جويستيك)'], 20, 14, 9, 20, '', 25],
  ['طقم مفكات صيانة الهاتف', ['أدوات الصيانة'], 35, 27, 20, 6, '', null],
  ['بطارية هاتف (حسب الموديل)', ['قطع الغيار', 'بطاريات'], 75, 60, 48, 5, '', null],
];

function seed() {
  reindexSearch();
  const catalog = loadCatalog();
  if (!get("SELECT 1 AS x FROM settings WHERE key = '_taxonomy_v2'")) {
    tx(() => { seedTaxonomy(catalog.taxonomy); run("INSERT INTO settings(key, value) VALUES('_taxonomy_v2', 'true')"); });
  } else {
    // add subcategories introduced by later catalog batches (never re-creates what the admin deleted at top level)
    tx(() => catalog.taxonomy.forEach((c) => {
      const par = get('SELECT id, icon FROM categories WHERE name = ? AND parent_id IS NULL', c.name); if (!par) return;
      (c.subs || []).forEach(([n, d], j) => { if (!get('SELECT 1 AS x FROM categories WHERE name = ? AND parent_id = ?', n, par.id)) run('INSERT INTO categories(name, slug, icon, description, sort_order, parent_id) VALUES(?,?,?,?,?,?)', n, uniqueSlug('categories', n), par.icon, d || null, j, par.id); });
    }));
  }
  for (const [slug, [title, content]] of Object.entries(SEED_PAGES)) {
    run('INSERT OR IGNORE INTO pages(slug, title, content) VALUES(?,?,?)', slug, title, content);
  }
  if (!get("SELECT 1 AS x FROM settings WHERE key = '_banners_seeded'")) {
    SEED_BANNERS.forEach(([t, s, c, l, th], i) => run('INSERT INTO banners(title, subtitle, cta_text, link, theme, sort_order) VALUES(?,?,?,?,?,?)', t, s, c, l, th, i));
    run("INSERT INTO settings(key, value) VALUES('_banners_seeded', 'true')");
  }
  if (String(process.env.SEED_SAMPLE_PRODUCTS).toLowerCase() === 'true' && !get('SELECT 1 AS x FROM products LIMIT 1')) {
    seedSampleProducts();
  }
  // The shop's real photographed products are loaded once into a new store (disable with SEED_CATALOG=false).
  // New batches appended to catalog.json are added on the next start; products already loaded (or deleted by the admin) are not touched.
  if (String(process.env.SEED_CATALOG).toLowerCase() !== 'false') {
    const r = get("SELECT value FROM settings WHERE key = '_catalog_seeded'");
    const done = r ? (Number(JSON.parse(r.value)) || (r.value === 'true' ? 38 : 0)) : 0;
    if (catalog.products.length > done) {
      seedCatalog(catalog, done);
      run("INSERT INTO settings(key, value) VALUES('_catalog_seeded', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(catalog.products.length));
    }
  }
}
function seedSampleProducts() {
  tx(() => {
    SAMPLE_PRODUCTS.forEach(([name, cat, price, wholesale, cost, stock, badge, compare], i) => {
      const cid = categoryId(cat[0], cat[1]);
      const sku = 'KA-' + String(1001 + i);
      const r = run(`INSERT INTO products(name, slug, sku, category_id, brand, price, compare_at_price, wholesale_price, wholesale_min_qty, cost_price, stock, badge, featured, short_description, description)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        name, uniqueSlug('products', name), sku, cid, 'متنوع', price, compare, wholesale, 10, cost, stock, badge || null, i < 8 ? 1 : 0,
        `${name} بجودة عالية وضمان استبدال.`,
        `${name}.\n\n- منتج مختار بعناية ومفحوص قبل التسليم.\n- سعر الجملة يُطبَّق تلقائياً عند طلب 10 قطع أو أكثر.\n- متوفر للتوصيل داخل سبها وإلى جميع المدن الليبية.`);
      const id = Number(r.lastInsertRowid);
      run('INSERT INTO stock_movements(product_id, change, stock_after, reason) VALUES(?,?,?,?)', id, stock, stock, 'رصيد افتتاحي');
      refreshSearchText(id);
    });
  });
}

module.exports = { db, DB_FILE, all, get, run, tx, getSetting, setSetting, getSettings, sessionSecret, refreshSearchText, buildSearchText, uniqueSlug, seed, seedSampleProducts, seedCatalog, loadCatalog, categoryId, DEFAULT_SETTINGS };
