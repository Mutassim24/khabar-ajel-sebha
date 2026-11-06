'use strict';
// Storefront pages + public JSON API.
const { all, get, run, getSettings } = require('./db');
const store = require('./store');
const views = require('./views');
const { sendHtml, sendJson, send, redirect, jsonBody, clientIp, HttpError } = require('./http');
const { validate, normalizePhone, isValidPhone } = require('./util');
const { rateLimit, currentAdmin } = require('./auth');
const { invoicePage } = require('./invoice');

function register(r) {
  // ---------- pages ----------
  r.get('/', (req, res) => {
    const data = {
      banners: all('SELECT * FROM banners WHERE active = 1 ORDER BY sort_order, id'),
      categories: req.ctx.categories,
      sale: store.listProducts({ sale: true, per: 8, sort: 'bestsellers' }).items,
      featured: store.listProducts({ featured: true, per: 8 }).items,
      best: store.listProducts({ sort: 'bestsellers', per: 8 }).items.filter((p) => p.sold_count > 0),
      newest: store.listProducts({ sort: 'newest', per: 8 }).items,
    };
    sendHtml(req, res, 200, views.home(req, data));
  });

  const shopHandler = (req, res, params) => {
    const q = req.query;
    let category = null;
    if (params.slug) {
      category = req.ctx.categories.find((c) => c.slug === params.slug);
      if (!category) return sendHtml(req, res, 404, views.notFound(req));
    }
    const filters = {
      q: (q.q || '').slice(0, 100), min: q.min, max: q.max, inStock: q.stock === '1', sale: q.sale === '1',
      featured: q.featured === '1', wholesale: q.wholesale === '1', sort: store.SORTS[q.sort] ? q.sort : '', page: q.page,
    };
    const result = store.listProducts({ ...filters, category: category && category.slug });
    const parent = category && category.parent_id ? req.ctx.categories.find((c) => c.id === category.parent_id) : null;
    const subs = category ? (parent || category).children.filter((c) => c.product_count > 0) : [];
    sendHtml(req, res, 200, views.shop(req, { filters, result, category, parent, subs, categories: req.ctx.categories }));
  };
  r.get('/shop', shopHandler);
  r.get('/category/:slug', shopHandler);
  r.get('/categories', (req, res) => sendHtml(req, res, 200, views.categoriesPage(req, req.ctx.categories)));

  r.get('/product/:slug', (req, res, params) => {
    const p = store.getProductBySlug(params.slug);
    if (!p) return sendHtml(req, res, 404, views.notFound(req));
    sendHtml(req, res, 200, views.productPage(req, p, store.relatedProducts(p)));
  });
  r.get('/cart', (req, res) => sendHtml(req, res, 200, views.cartPage(req)));
  r.get('/checkout', (req, res) => sendHtml(req, res, 200, views.checkoutPage(req)));
  r.get('/favorites', (req, res) => sendHtml(req, res, 200, views.favoritesPage(req)));
  r.get('/order/:number', (req, res, params) => {
    const row = get('SELECT id, token FROM orders WHERE number = ?', params.number);
    if (!row || !req.query.t || req.query.t !== row.token) return sendHtml(req, res, 404, views.notFound(req));
    sendHtml(req, res, 200, views.orderSuccess(req, store.getOrder(row.id)));
  });
  // printable invoice: the customer (order token) or any logged-in admin
  r.get('/invoice/:number', (req, res, params) => {
    const row = get('SELECT id, token FROM orders WHERE number = ?', params.number);
    const admin = currentAdmin(req);
    if (!row || (!admin && (!req.query.t || req.query.t !== row.token))) return sendHtml(req, res, 404, views.notFound(req));
    sendHtml(req, res, 200, invoicePage({ order: store.getOrder(row.id), settings: getSettings(), isAdmin: !!admin }), { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  });
  r.get('/track', (req, res) => {
    const number = String(req.query.number || '').trim().toUpperCase().slice(0, 30);
    const phone = String(req.query.phone || '').slice(0, 30);
    let order = null; let error = null;
    if (number || phone) {
      const rl = rateLimit('track:' + clientIp(req), 30, 10 * 60e3);
      if (!rl.ok) error = 'محاولات كثيرة، حاول لاحقاً';
      else {
        const row = get('SELECT id FROM orders WHERE number = ? AND phone = ?', number, normalizePhone(phone));
        if (row) order = store.getOrder(row.id); else error = 'لم نعثر على طلب بهذه البيانات. تأكد من رقم الطلب ورقم الهاتف.';
      }
    }
    sendHtml(req, res, 200, views.trackPage(req, { order, error, number, phone }));
  });
  r.get('/page/:slug', (req, res, params) => {
    const page = get('SELECT * FROM pages WHERE slug = ?', params.slug);
    if (!page) return sendHtml(req, res, 404, views.notFound(req));
    sendHtml(req, res, 200, views.staticPage(req, page));
  });
  // legacy-friendly short links
  for (const [from, to] of [['/about', '/page/about'], ['/privacy', '/page/privacy'], ['/shipping', '/page/shipping'], ['/contact', '/page/contact']]) {
    r.get(from, (req, res) => redirect(res, to, 301));
  }

  // ---------- SEO ----------
  r.get('/robots.txt', (req, res) => {
    const base = views.siteUrl(req);
    send(req, res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\nDisallow: /cart\nDisallow: /order/\n\nSitemap: ${base}/sitemap.xml\n`, 'text/plain; charset=utf-8');
  });
  r.get('/sitemap.xml', (req, res) => {
    const base = views.siteUrl(req);
    const urls = [['/', 'daily'], ['/shop', 'daily'], ['/categories', 'weekly']];
    for (const c of req.ctx.categories) urls.push([`/category/${c.slug}`, 'daily']);
    for (const p of all('SELECT slug, updated_at FROM products WHERE active = 1')) urls.push([`/product/${p.slug}`, 'weekly', p.updated_at]);
    for (const p of all('SELECT slug, updated_at FROM pages')) urls.push([`/page/${p.slug}`, 'monthly', p.updated_at]);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, f, m]) => `<url><loc>${base}${encodeURI(u)}</loc><changefreq>${f}</changefreq>${m ? `<lastmod>${m.slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`;
    send(req, res, 200, xml, 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
  });
  r.get('/manifest.webmanifest', (req, res) => {
    const s = getSettings();
    sendJson(req, res, 200, { name: s.store_name, short_name: s.store_name, lang: 'ar', dir: 'rtl', start_url: '/', display: 'standalone', background_color: '#f5f7fb', theme_color: '#0f2240', icons: [{ src: '/img/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] }, { 'Cache-Control': 'public, max-age=86400' });
  });

  // ---------- media ----------
  r.get('/media/:id', (req, res, params) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) return send(req, res, 404, 'Not found', 'text/plain');
    const small = Number(req.query.w) > 0 && Number(req.query.w) <= 600;
    const etag = `"m${id}${small ? 's' : ''}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    const m = get(`SELECT ${small ? 'COALESCE(thumb, data)' : 'data'} AS data, mime FROM media WHERE id = ?`, id);
    if (!m) return send(req, res, 404, 'Not found', 'text/plain');
    // media rows are immutable (a replaced image gets a new id) => cache forever
    send(req, res, 200, Buffer.from(m.data), m.mime, { 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag });
  });

  // ---------- public API ----------
  r.get('/api/products', (req, res) => {
    const q = req.query;
    const result = store.listProducts({ q: q.q, category: q.category, min: q.min, max: q.max, inStock: q.stock === '1', sale: q.sale === '1', sort: q.sort, page: q.page, per: q.per, ids: q.ids });
    sendJson(req, res, 200, result);
  });
  r.get('/api/search/suggest', (req, res) => sendJson(req, res, 200, { items: store.suggest(String(req.query.q || '').slice(0, 60)) }));
  r.get('/partials/cards', (req, res) => {
    const result = store.listProducts({ ids: req.query.ids || '', per: 100 });
    sendHtml(req, res, 200, views.grid(result.items, 'لم تُضِف أي منتج إلى المفضلة بعد.').s);
  });
  r.post('/api/quote', async (req, res) => {
    const b = await jsonBody(req);
    sendJson(req, res, 200, store.quote({ items: b.items, coupon: typeof b.coupon === 'string' ? b.coupon.slice(0, 40) : '', zone: b.zone }));
  });
  r.post('/api/orders', async (req, res) => {
    const ip = clientIp(req);
    const rl = rateLimit('order:' + ip, 8, 15 * 60e3);
    if (!rl.ok) throw new HttpError(429, 'تم إرسال طلبات كثيرة من هذا الجهاز، يرجى المحاولة بعد قليل');
    const b = await jsonBody(req);
    if (b.website) throw new HttpError(400, 'تعذّر إرسال الطلب'); // honeypot
    const d = validate(b, {
      name: { type: 'string', required: true, min: 2, max: 80, label: 'الاسم' },
      phone: { type: 'string', required: true, max: 30, label: 'رقم الهاتف' },
      zone: { type: 'int', required: true, min: 0, max: 100, label: 'منطقة التوصيل' },
      address: { type: 'string', required: true, min: 3, max: 300, label: 'العنوان' },
      notes: { type: 'string', max: 500, label: 'الملاحظات' },
      payment_method: { type: 'string', required: true, max: 20, label: 'طريقة الدفع' },
      coupon: { type: 'string', max: 40 },
      items: { type: 'array', required: true, max: 100, label: 'المنتجات' },
    });
    d.phone = normalizePhone(d.phone);
    if (!isValidPhone(d.phone)) throw Object.assign(new HttpError(400, 'رقم الهاتف غير صحيح'), {});
    const order = store.createOrder(d, ip);
    console.log(`[order] ${order.number} total=${order.total} items=${order.items.length}`);
    sendJson(req, res, 201, { number: order.number, token: order.token, url: `/order/${order.number}?t=${order.token}`, whatsapp_url: order.whatsapp_url, total: order.total });
  });
  r.post('/api/contact', async (req, res) => {
    const rl = rateLimit('contact:' + clientIp(req), 5, 30 * 60e3);
    if (!rl.ok) throw new HttpError(429, 'تم إرسال رسائل كثيرة، حاول لاحقاً');
    const b = await jsonBody(req, 16 * 1024);
    if (b.website) throw new HttpError(400, 'تعذّر الإرسال');
    const d = validate(b, {
      name: { type: 'string', required: true, min: 2, max: 80, label: 'الاسم' },
      phone: { type: 'string', max: 20, label: 'الهاتف' },
      subject: { type: 'string', max: 120, label: 'الموضوع' },
      body: { type: 'string', required: true, min: 3, max: 2000, label: 'الرسالة' },
    });
    run('INSERT INTO messages(name, phone, subject, body) VALUES(?,?,?,?)', d.name, d.phone ? normalizePhone(d.phone) : null, d.subject, d.body);
    sendJson(req, res, 201, { ok: true });
  });
}

module.exports = { register };
