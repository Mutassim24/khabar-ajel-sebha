'use strict';
// Catalogue queries, pricing/quotes, orders, inventory. Shared by storefront, public API and admin API.
const { all, get, run, tx, getSettings } = require('./db');
const { round2, searchTokens, SYNONYMS, normalizeAr, randomToken, STATUS, money, phoneIntl } = require('./util');

const PRODUCT_COLS = `p.id, p.name, p.slug, p.sku, p.category_id, p.brand, p.tags, p.short_description, p.price, p.compare_at_price,
  p.wholesale_price, p.wholesale_min_qty, p.stock, p.low_stock_threshold, p.active, p.featured, p.badge, p.sold_count, p.created_at,
  c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon, c.parent_id AS category_parent_id,
  (SELECT name FROM categories WHERE id = c.parent_id) AS parent_name, (SELECT slug FROM categories WHERE id = c.parent_id) AS parent_slug,
  (SELECT media_id FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_id,
  (SELECT media_id FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order, id LIMIT 1 OFFSET 1) AS image2_id`;

function availability(p) {
  if (!p.active) return { key: 'hidden', label: 'غير متاح' };
  if (!(p.price > 0)) return { key: 'ask', label: 'اسأل عن التوفر' };
  if (p.stock <= 0) return { key: 'out', label: 'نفد المخزون' };
  if (p.stock <= (p.low_stock_threshold || 0)) return { key: 'low', label: `كمية محدودة (${p.stock})` };
  return { key: 'in', label: 'متوفر' };
}
function decorate(p) {
  if (!p) return p;
  p.availability = availability(p);
  p.discount_pct = p.compare_at_price && p.compare_at_price > p.price ? Math.round((1 - p.price / p.compare_at_price) * 100) : 0;
  p.has_wholesale = !!(p.wholesale_price && p.wholesale_price > 0 && p.wholesale_price < p.price);
  return p;
}

const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  'price-asc': 'p.price <= 0, p.price ASC',
  'price-desc': 'p.price DESC',
  bestsellers: 'p.sold_count DESC, p.id DESC',
  name: 'p.name COLLATE NOCASE ASC',
  featured: 'p.featured DESC, p.sold_count DESC, (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) > 0 DESC, p.id DESC',
};

/** Search + filter + sort + paginate active products. */
function listProducts(f = {}) {
  const where = ['p.active = 1']; const params = [];
  if (f.category) { where.push('(c.slug = ? OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))'); params.push(f.category, f.category); }
  if (f.categoryId) { where.push('p.category_id = ?'); params.push(f.categoryId); }
  if (f.min != null && f.min !== '' && !isNaN(f.min)) { where.push('p.price >= ?'); params.push(Number(f.min)); }
  if (f.max != null && f.max !== '' && !isNaN(f.max)) { where.push('p.price <= ?'); params.push(Number(f.max)); }
  if (f.inStock) where.push('p.stock > 0');
  if (f.sale) where.push('p.compare_at_price > p.price');
  if (f.featured) where.push('p.featured = 1');
  if (f.wholesale) where.push('p.wholesale_price > 0 AND p.wholesale_price < p.price');
  if (f.ids) {
    const ids = String(f.ids).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
    if (!ids.length) return { items: [], total: 0, page: 1, pages: 0 };
    where.push(`p.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids);
  }
  // Smart search: every token (or one of its synonyms) must match the normalized search text.
  const tokens = f.q ? searchTokens(f.q) : [];
  for (const t of tokens) {
    const alts = [t, ...(SYNONYMS[t] || [])].map(normalizeAr);
    // match at the start of a word (optionally after the Arabic article "ال") so "ابل" doesn't match inside "كابل"
    where.push('(' + alts.map(() => '(p.search_text LIKE ? OR p.search_text LIKE ?)').join(' OR ') + ')');
    for (const a of alts) params.push(`% ${a}%`, `% ال${a}%`);
  }
  const sql = `FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
  const total = get(`SELECT COUNT(*) AS n ${sql}`, ...params).n;
  const per = Math.min(Math.max(Number(f.per) || 24, 1), 100);
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(Math.max(Number(f.page) || 1, 1), pages);
  let order = SORTS[f.sort] || (tokens.length ? null : SORTS.featured);
  if (!order) {
    // relevance: products whose name starts with / contains the query rank first
    const nq = normalizeAr(f.q);
    order = `CASE WHEN p.search_text LIKE ? THEN 0 WHEN p.search_text LIKE ? THEN 1 ELSE 2 END, p.sold_count DESC`;
    params.push(` ${nq}%`, `% ${nq}%`);
  }
  const items = all(`SELECT ${PRODUCT_COLS} ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per).map(decorate);
  if (f.ids) { const order2 = String(f.ids).split(',').map(Number); items.sort((a, b) => order2.indexOf(a.id) - order2.indexOf(b.id)); }
  return { items, total, page, pages, per };
}

function getProductBySlug(slug, includeInactive = false) {
  const p = get(`SELECT ${PRODUCT_COLS}, p.description, p.updated_at FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.slug = ?`, slug);
  if (!p || (!p.active && !includeInactive)) return null;
  p.images = all('SELECT media_id FROM product_images WHERE product_id = ? ORDER BY sort_order, id', p.id).map((r) => r.media_id);
  return decorate(p);
}

function relatedProducts(p, n = 4) {
  return all(`SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 AND p.id != ? AND p.category_id IS ? ORDER BY p.stock > 0 DESC, p.sold_count DESC LIMIT ?`, p.id, p.category_id, n).map(decorate);
}

/** All categories (parents and subcategories) with active product counts; a parent's count includes its children. */
function categoriesWithCounts(includeInactive = false) {
  const rows = all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.active = 1 AND (p.category_id = c.id OR p.category_id IN (SELECT id FROM categories WHERE parent_id = c.id))) AS product_count,
    COALESCE(c.media_id, (SELECT pi.media_id FROM products p JOIN product_images pi ON pi.product_id = p.id
      WHERE p.active = 1 AND (p.category_id = c.id OR p.category_id IN (SELECT id FROM categories WHERE parent_id = c.id))
      ORDER BY p.featured DESC, p.sold_count DESC, p.id, pi.sort_order, pi.id LIMIT 1)) AS cover_id
    FROM categories c ${includeInactive ? '' : 'WHERE c.active = 1 AND (c.parent_id IS NULL OR (SELECT active FROM categories WHERE id = c.parent_id) = 1)'} ORDER BY c.sort_order, c.id`);
  for (const r of rows) r.children = rows.filter((x) => x.parent_id === r.id);
  return rows;
}

function suggest(q) {
  if (!q || normalizeAr(q).length < 2) return [];
  return listProducts({ q, per: 6 }).items.map((p) => ({ name: p.name, slug: p.slug, price: p.price, image_id: p.image_id, icon: p.category_icon }));
}

// ---------- coupons ----------
function findCoupon(code, subtotal) {
  if (!code) return { coupon: null };
  const c = get('SELECT * FROM coupons WHERE code = ?', String(code).trim());
  const now = new Date().toISOString();
  if (!c || !c.active) return { error: 'كود الخصم غير صحيح' };
  if (c.starts_at && c.starts_at > now) return { error: 'كود الخصم لم يبدأ بعد' };
  if (c.ends_at && c.ends_at < now) return { error: 'انتهت صلاحية كود الخصم' };
  if (c.usage_limit && c.used_count >= c.usage_limit) return { error: 'تم استنفاد كود الخصم' };
  if (c.min_order && subtotal < c.min_order) return { error: `كود الخصم يتطلب طلباً بقيمة ${money(c.min_order)} على الأقل` };
  return { coupon: c };
}
function couponDiscount(c, subtotal) {
  if (!c) return 0;
  let d = c.type === 'percent' ? subtotal * (c.value / 100) : c.value;
  if (c.max_discount) d = Math.min(d, c.max_discount);
  return round2(Math.min(d, subtotal));
}

/**
 * Price a cart server-side. Never trusts client prices.
 * items: [{id, qty}] ; returns lines, totals and any per-line errors.
 */
function quote({ items = [], coupon: code = '', zone = null } = {}) {
  const s = getSettings();
  const merged = new Map();
  for (const it of Array.isArray(items) ? items.slice(0, 100) : []) {
    const id = Number(it && it.id); const qty = Math.floor(Number(it && it.qty));
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(qty) || qty <= 0) continue;
    merged.set(id, Math.min((merged.get(id) || 0) + qty, 999));
  }
  const lines = []; const errors = [];
  for (const [id, qty] of merged) {
    const p = get(`SELECT ${PRODUCT_COLS}, p.cost_price FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, id);
    if (!p || !p.active) { errors.push({ id, message: 'منتج لم يعد متاحاً وتمت إزالته' }); lines.push({ id, removed: true }); continue; }
    decorate(p);
    const wholesale = p.has_wholesale && qty >= (p.wholesale_min_qty || 1);
    const unit = wholesale ? p.wholesale_price : p.price;
    const line = {
      id, qty, name: p.name, slug: p.slug, sku: p.sku, image_id: p.image_id, icon: p.category_icon, stock: p.stock,
      unit_price: unit, retail_price: p.price, price_type: wholesale ? 'wholesale' : 'retail', cost_price: p.cost_price || 0,
      wholesale_price: p.has_wholesale ? p.wholesale_price : null, wholesale_min_qty: p.has_wholesale ? p.wholesale_min_qty : null,
      line_total: round2(unit * qty),
    };
    if (!(p.price > 0)) { line.error = 'السعر غير محدد — اسألنا عبر واتساب'; errors.push({ id, message: `«${p.name}» سعره عند الطلب، تواصل معنا لتأكيده` }); }
    else if (p.stock <= 0) { line.error = 'نفد من المخزون'; errors.push({ id, message: `«${p.name}» نفد من المخزون` }); }
    else if (qty > p.stock) { line.error = `المتوفر ${p.stock} فقط`; errors.push({ id, message: `الكمية المتوفرة من «${p.name}» هي ${p.stock} فقط` }); }
    lines.push(line);
  }
  const valid = lines.filter((l) => !l.removed);
  const subtotal = round2(valid.reduce((a, l) => a + l.line_total, 0));
  const savings = round2(valid.reduce((a, l) => a + (l.retail_price - l.unit_price) * l.qty, 0));
  let coupon = null; let couponError = null; let discount = 0;
  if (code) {
    const r = findCoupon(code, subtotal);
    if (r.error) couponError = r.error; else { coupon = r.coupon; discount = couponDiscount(coupon, subtotal); }
  }
  const zones = Array.isArray(s.shipping_zones) ? s.shipping_zones : [];
  let shipping = 0; let zoneObj = null;
  if (zone !== null && zone !== undefined && zone !== '') {
    zoneObj = zones[Number(zone)] || null;
    if (zoneObj) shipping = round2(zoneObj.fee);
  }
  const free = Number(s.free_shipping_over) > 0 && subtotal - discount >= Number(s.free_shipping_over);
  if (free) shipping = 0;
  return {
    lines: valid, removed: lines.filter((l) => l.removed).map((l) => l.id), errors,
    count: valid.reduce((a, l) => a + l.qty, 0),
    subtotal, wholesale_savings: savings, discount, coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null, coupon_error: couponError,
    shipping, free_shipping: free, zone: zoneObj, total: round2(subtotal - discount + shipping),
  };
}

// ---------- orders ----------
function whatsappText(o, items) {
  const s = getSettings();
  const lines = items.map((i) => `• ${i.name} × ${i.qty} = ${money(i.line_total)}${i.price_type === 'wholesale' ? ' (جملة)' : ''}`);
  return [
    `السلام عليكم، أرغب بتأكيد طلبي من ${s.store_name}`,
    `رقم الطلب: ${o.number}`,
    '',
    ...lines,
    '',
    `المجموع: ${money(o.subtotal)}`,
    o.discount ? `الخصم${o.coupon_code ? ' (' + o.coupon_code + ')' : ''}: -${money(o.discount)}` : null,
    `التوصيل: ${money(o.shipping_fee)}`,
    `الإجمالي: ${money(o.total)}`,
    `طريقة الدفع: ${o.payment_label}`,
    '',
    `الاسم: ${o.customer_name}`,
    `الهاتف: ${o.phone}`,
    `العنوان: ${[o.city, o.address].filter(Boolean).join(' — ')}`,
    o.notes ? `ملاحظات: ${o.notes}` : null,
  ].filter((x) => x !== null).join('\n');
}
function whatsappLink(text) {
  const n = String(getSettings().whatsapp || '').replace(/\D/g, '');
  if (!n) return null;
  return `https://wa.me/${phoneIntl(n)}?text=${encodeURIComponent(text)}`;
}

class OrderError extends Error { constructor(msg, extra) { super(msg); this.status = 409; Object.assign(this, extra); } }

function createOrder(data, ip) {
  const s = getSettings();
  const methods = (s.payment_methods || []).filter((m) => m.enabled);
  const method = methods.find((m) => m.id === data.payment_method);
  if (!method) throw new OrderError('طريقة الدفع غير متاحة');
  return tx(() => {
    const q = quote({ items: data.items, coupon: data.coupon, zone: data.zone });
    if (!q.lines.length) throw new OrderError('السلة فارغة');
    if (q.errors.length) throw new OrderError(q.errors.map((e) => e.message).join(' — '), { quote: q });
    if (data.coupon && q.coupon_error) throw new OrderError(q.coupon_error, { quote: q });
    if (!q.zone) throw new OrderError('يرجى اختيار منطقة التوصيل');

    // customer upsert by phone
    let cust = get('SELECT * FROM customers WHERE phone = ?', data.phone);
    if (cust) run("UPDATE customers SET name = ?, city = ?, address = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", data.name, q.zone.name, data.address, cust.id);
    else cust = { id: Number(run('INSERT INTO customers(name, phone, city, address) VALUES(?,?,?,?)', data.name, data.phone, q.zone.name, data.address).lastInsertRowid) };

    const cost = round2(q.lines.reduce((a, l) => a + l.cost_price * l.qty, 0));
    const r = run(`INSERT INTO orders(token, customer_id, customer_name, phone, city, address, notes, payment_method, payment_label, subtotal, discount, shipping_fee, total, cost_total, coupon_code, ip)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      randomToken(18), cust.id, data.name, data.phone, q.zone.name, data.address, data.notes || null, method.id, method.name,
      q.subtotal, q.discount, q.shipping, q.total, cost, q.coupon ? q.coupon.code : null, ip || null);
    const orderId = Number(r.lastInsertRowid);
    const d = new Date();
    const number = `KH${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(orderId).padStart(4, '0')}`;
    run('UPDATE orders SET number = ? WHERE id = ?', number, orderId);

    for (const l of q.lines) {
      run('INSERT INTO order_items(order_id, product_id, name, sku, unit_price, cost_price, qty, price_type, line_total) VALUES(?,?,?,?,?,?,?,?,?)',
        orderId, l.id, l.name, l.sku, l.unit_price, l.cost_price, l.qty, l.price_type, l.line_total);
      // atomic decrement guarded against overselling
      const u = run('UPDATE products SET stock = stock - ?, sold_count = sold_count + ? WHERE id = ? AND stock >= ?', l.qty, l.qty, l.id, l.qty);
      if (Number(u.changes) !== 1) throw new OrderError(`الكمية المطلوبة من «${l.name}» لم تعد متوفرة`);
      const after = get('SELECT stock FROM products WHERE id = ?', l.id).stock;
      run('INSERT INTO stock_movements(product_id, change, stock_after, reason, ref) VALUES(?,?,?,?,?)', l.id, -l.qty, after, 'طلب جديد', number);
    }
    if (q.coupon) run('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', q.coupon.code);
    run('INSERT INTO order_history(order_id, status, note) VALUES(?,?,?)', orderId, 'new', 'تم استلام الطلب من الموقع');
    return getOrder(orderId);
  });
}

function getOrder(id) {
  const o = get('SELECT * FROM orders WHERE id = ?', id);
  if (!o) return null;
  o.items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', id);
  o.history = all('SELECT h.*, a.name AS admin_name FROM order_history h LEFT JOIN admins a ON a.id = h.admin_id WHERE order_id = ? ORDER BY h.id', id);
  o.status_label = STATUS[o.status];
  o.profit = round2(o.subtotal - o.discount - o.cost_total);
  o.whatsapp_text = whatsappText(o, o.items);
  o.whatsapp_url = whatsappLink(o.whatsapp_text);
  return o;
}

const TRANSITIONS = {
  new: ['processing', 'shipped', 'completed', 'cancelled'],
  processing: ['shipped', 'completed', 'cancelled', 'new'],
  shipped: ['completed', 'cancelled', 'processing'],
  completed: ['shipped'],
  cancelled: ['new'],
};
/** Change order status; cancelling returns stock, re-opening a cancelled order re-reserves it. */
function setOrderStatus(id, status, note, adminId) {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ?', id);
    if (!o) throw Object.assign(new Error('الطلب غير موجود'), { status: 404 });
    if (o.status === status) return getOrder(id);
    if (!(TRANSITIONS[o.status] || []).includes(status)) throw new OrderError(`لا يمكن تغيير الحالة من «${STATUS[o.status]}» إلى «${STATUS[status]}»`);
    const items = all('SELECT * FROM order_items WHERE order_id = ?', id);
    if (status === 'cancelled') {
      for (const i of items) if (i.product_id) {
        run('UPDATE products SET stock = stock + ?, sold_count = MAX(0, sold_count - ?) WHERE id = ?', i.qty, i.qty, i.product_id);
        const p = get('SELECT stock FROM products WHERE id = ?', i.product_id);
        if (p) run('INSERT INTO stock_movements(product_id, change, stock_after, reason, ref, admin_id) VALUES(?,?,?,?,?,?)', i.product_id, i.qty, p.stock, 'إلغاء طلب', o.number, adminId);
      }
      if (o.coupon_code) run('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?', o.coupon_code);
    } else if (o.status === 'cancelled') {
      for (const i of items) if (i.product_id) {
        const u = run('UPDATE products SET stock = stock - ?, sold_count = sold_count + ? WHERE id = ? AND stock >= ?', i.qty, i.qty, i.product_id, i.qty);
        if (Number(u.changes) !== 1) throw new OrderError(`لا يوجد مخزون كافٍ من «${i.name}» لإعادة فتح الطلب`);
        const p = get('SELECT stock FROM products WHERE id = ?', i.product_id);
        run('INSERT INTO stock_movements(product_id, change, stock_after, reason, ref, admin_id) VALUES(?,?,?,?,?,?)', i.product_id, -i.qty, p.stock, 'إعادة فتح طلب', o.number, adminId);
      }
      if (o.coupon_code) run('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', o.coupon_code);
    }
    run("UPDATE orders SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", status, id);
    run('INSERT INTO order_history(order_id, status, note, admin_id) VALUES(?,?,?,?)', id, status, note || null, adminId || null);
    return getOrder(id);
  });
}

/** Manual stock adjustment with an audit trail. */
function adjustStock(productId, change, reason, adminId) {
  return tx(() => {
    const p = get('SELECT stock FROM products WHERE id = ?', productId);
    if (!p) throw Object.assign(new Error('المنتج غير موجود'), { status: 404 });
    const after = p.stock + change;
    if (after < 0) throw new OrderError('لا يمكن أن يصبح المخزون أقل من صفر');
    run("UPDATE products SET stock = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", after, productId);
    run('INSERT INTO stock_movements(product_id, change, stock_after, reason, admin_id) VALUES(?,?,?,?,?)', productId, change, after, reason || 'تعديل يدوي', adminId || null);
    return after;
  });
}

module.exports = {
  PRODUCT_COLS, decorate, availability, listProducts, getProductBySlug, relatedProducts, categoriesWithCounts, suggest,
  quote, createOrder, getOrder, setOrderStatus, adjustStock, OrderError, whatsappLink, SORTS, TRANSITIONS,
};
