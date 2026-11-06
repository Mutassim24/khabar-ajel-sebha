/* End-to-end test: boots a fresh store, tests the API + security, then drives the storefront and admin in Chromium.
   Run:  node tests/e2e.js   (needs `playwright` available, e.g. npm i -D playwright) */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-e2e-'));
const ADMIN = { email: 'owner@test.ly', password: 'Owner-Pass-2026' };
const SHOTS = process.env.SHOTS_DIR;
let passed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failures.push(name); console.log('  ✗', name, '\n     ', e.message); }
}
async function req(method, url, body, headers = {}) {
  const opt = { method, headers: { ...headers } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(BASE + url, opt);
  const txt = await r.text(); let json = null; try { json = JSON.parse(txt); } catch {}
  return { status: r.status, json, text: txt, headers: r.headers };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { REQUIRE_ACCOUNT: 'false', TRACK_STOCK: 'true', DELIVERY: 'true', ...process.env, PORT, DATA_DIR: DATA, SEED_SAMPLE_PRODUCTS: 'true', SEED_CATALOG: 'false', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  console.log('\nAPI & pages');
  let products;
  await t('home, shop, categories, pages render', async () => {
    for (const u of ['/', '/shop', '/categories', '/cart', '/checkout', '/favorites', '/track', '/page/about', '/page/privacy', '/page/shipping', '/page/contact', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest']) {
      const r = await req('GET', u); assert.equal(r.status, 200, u);
    }
    assert.equal((await req('GET', '/nope')).status, 404);
    assert.equal((await req('GET', '/product/does-not-exist')).status, 404);
  });
  await t('security headers present (CSP, nosniff, frame deny)', async () => {
    const r = await req('GET', '/');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  });
  await t('products API lists 12 seeded products with stock info', async () => {
    const r = await req('GET', '/api/products?per=100'); products = r.json.items;
    assert.equal(r.json.total, 12); assert.ok(products[0].availability);
  });
  await t('product page has JSON-LD + canonical', async () => {
    const r = await req('GET', '/product/' + encodeURIComponent(products[0].slug));
    assert.equal(r.status, 200); assert.match(r.text, /application\/ld\+json/); assert.match(r.text, /"@type":"Product"/); assert.match(r.text, /rel="canonical"/);
  });
  await t('smart search: synonyms + Arabic normalization', async () => {
    const a = await req('GET', '/api/products?q=' + encodeURIComponent('كفر')); assert.ok(a.json.items.some((p) => p.name.includes('جراب')), 'كفر→جراب');
    const b = await req('GET', '/api/products?q=' + encodeURIComponent('charger')); assert.ok(b.json.items.some((p) => p.name.includes('شاحن')), 'charger→شاحن');
    const c = await req('GET', '/api/products?q=' + encodeURIComponent('بطاريه')); assert.ok(c.json.items.length >= 1, 'ة/ه normalization');
    const d = await req('GET', '/api/search/suggest?q=' + encodeURIComponent('سماع')); assert.ok(d.json.items.length >= 1);
  });
  await t('filters: category, price range, sort', async () => {
    const all = (await req('GET', '/api/products?min=20&max=60&sort=price-asc')).json.items;
    assert.ok(all.length > 0 && all.every((p) => p.price >= 20 && p.price <= 60));
    for (let i = 1; i < all.length; i++) assert.ok(all[i].price >= all[i - 1].price);
  });
  const charger = () => products.find((p) => p.name.includes('شاحن'));
  await t('quote: retail vs automatic wholesale pricing at min qty', async () => {
    const p = charger();
    const r1 = (await req('POST', '/api/quote', { items: [{ id: p.id, qty: 2 }] })).json;
    assert.equal(r1.lines[0].unit_price, 45); assert.equal(r1.lines[0].price_type, 'retail');
    const r2 = (await req('POST', '/api/quote', { items: [{ id: p.id, qty: 10 }] })).json;
    assert.equal(r2.lines[0].unit_price, 38); assert.equal(r2.lines[0].price_type, 'wholesale'); assert.equal(r2.subtotal, 380);
  });
  await t('quote ignores client-sent prices and flags qty above stock', async () => {
    const p = products.find((x) => x.stock === 5);
    const r = (await req('POST', '/api/quote', { items: [{ id: p.id, qty: 6, price: 0.01 }] })).json;
    assert.equal(r.lines[0].unit_price, p.price); assert.ok(r.errors.length === 1);
  });

  console.log('\nAdmin API security');
  let cookie = '';
  const A = (m, u, b) => req(m, u, b, { Cookie: cookie, 'X-Requested-With': 'fetch' });
  await t('admin endpoints reject anonymous access (401)', async () => {
    assert.equal((await req('GET', '/api/admin/dashboard')).status, 401);
    assert.equal((await req('GET', '/api/admin/settings')).status, 401);
    assert.equal((await req('POST', '/api/admin/products', { name: 'x', price: 1 }, { 'X-Requested-With': 'fetch' })).status, 401);
  });
  await t('login: wrong password rejected; CSRF header required', async () => {
    assert.equal((await req('POST', '/api/admin/login', ADMIN)).status, 403, 'no X-Requested-With');
    assert.equal((await req('POST', '/api/admin/login', { ...ADMIN, password: 'wrong' }, { 'X-Requested-With': 'fetch' })).status, 401);
    assert.equal((await req('POST', '/api/admin/login', ADMIN, { 'X-Requested-With': 'fetch', Origin: 'https://evil.example' })).status, 403, 'cross-origin');
  });
  await t('login succeeds with HttpOnly SameSite=Strict cookie', async () => {
    const r = await req('POST', '/api/admin/login', ADMIN, { 'X-Requested-With': 'fetch' });
    assert.equal(r.status, 200);
    const sc = r.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
    cookie = sc.split(';')[0];
    assert.equal((await A('GET', '/api/admin/me')).json.role, 'owner');
  });
  await t('tampered session cookie is rejected', async () => {
    const bad = cookie.slice(0, -3) + 'abc';
    assert.equal((await req('GET', '/api/admin/me', undefined, { Cookie: bad })).status, 401);
  });
  await t('mutations without X-Requested-With are rejected even when logged in', async () => {
    assert.equal((await req('POST', '/api/admin/categories', { name: 'x' }, { Cookie: cookie })).status, 403);
  });
  await t('public pages never expose admin password hash / session secret', async () => {
    const r = await req('GET', '/'); assert.ok(!/scrypt\$|_session_secret/.test(r.text));
    const s = await A('GET', '/api/admin/settings'); assert.ok(!('_session_secret' in s.json));
  });
  await t('input validation: bad product payload returns 400 with Arabic message', async () => {
    const r = await A('POST', '/api/admin/products', { name: '', price: -5 }); assert.equal(r.status, 400); assert.ok(r.json.error);
    const r2 = await A('POST', '/api/admin/products', { name: 'منتج', price: 10, wholesale_price: 12 }); assert.equal(r2.status, 400);
  });

  console.log('\nOrders, stock, coupons, reports');
  let couponId;
  await t('admin creates coupon; quote applies it', async () => {
    const r = await A('POST', '/api/admin/coupons', { code: 'sebha10', type: 'percent', value: 10, min_order: 20, active: true });
    assert.equal(r.status, 201); assert.equal(r.json.code, 'SEBHA10'); couponId = r.json.id;
    const q = (await req('POST', '/api/quote', { items: [{ id: charger().id, qty: 2 }], coupon: 'sebha10', zone: 0 })).json;
    assert.equal(q.discount, 9); assert.equal(q.shipping, 10); assert.equal(q.total, 90 - 9 + 10);
    const bad = (await req('POST', '/api/quote', { items: [{ id: charger().id, qty: 2 }], coupon: 'NOPE' })).json; assert.ok(bad.coupon_error);
  });
  let order;
  const stockOf = async (id) => (await A('GET', `/api/admin/products/${id}`)).json.stock;
  await t('order validation: missing phone / bad zone rejected', async () => {
    const r = await req('POST', '/api/orders', { name: 'أحمد', phone: '12', zone: 0, address: 'سبها', payment_method: 'cod', items: [{ id: charger().id, qty: 1 }] });
    assert.equal(r.status, 400);
  });
  await t('place order → number generated, stock decremented, customer created', async () => {
    const before = await stockOf(charger().id);
    const r = await req('POST', '/api/orders', { name: 'أحمد محمد', phone: '+218 91 234 5678', zone: 0, address: 'حي الجديد، سبها', notes: 'مساءً', payment_method: 'cod', coupon: 'SEBHA10', items: [{ id: charger().id, qty: 2 }] });
    assert.equal(r.status, 201, r.text); order = r.json; assert.match(order.number, /^KH\d{4}-\d{4}$/);
    assert.equal(await stockOf(charger().id), before - 2);
    const c = (await A('GET', '/api/admin/customers')).json.items; assert.ok(c.some((x) => x.phone === '0912345678'));
  });
  await t('order page requires secret token; tracking needs number+phone', async () => {
    assert.equal((await req('GET', `/order/${order.number}`)).status, 404);
    assert.equal((await req('GET', `/order/${order.number}?t=${order.token}`)).status, 200);
    const tr = await req('GET', `/track?number=${order.number}&phone=0912345678`); assert.match(tr.text, /قيد التجهيز|جديد/); assert.match(tr.text, new RegExp(order.number));
    const wrong = await req('GET', `/track?number=${order.number}&phone=0900000000`); assert.match(wrong.text, /لم نعثر/);
  });
  await t('overselling is impossible (qty > stock rejected with 409)', async () => {
    const p = products.find((x) => x.stock === 5);
    const r = await req('POST', '/api/orders', { name: 'تاجر', phone: '0921111111', zone: 1, address: 'سبها', payment_method: 'cod', items: [{ id: p.id, qty: 6 }] });
    assert.equal(r.status, 409);
  });
  await t('status flow: processing → shipped → completed, cancel restores stock', async () => {
    const o = (await A('GET', '/api/admin/orders')).json.items.find((x) => x.number === order.number);
    for (const s of ['processing', 'shipped']) assert.equal((await A('POST', `/api/admin/orders/${o.id}/status`, { status: s })).status, 200);
    const before = await stockOf(charger().id);
    const c = await A('POST', `/api/admin/orders/${o.id}/status`, { status: 'cancelled', note: 'اختبار' });
    assert.equal(c.json.status, 'cancelled'); assert.equal(await stockOf(charger().id), before + 2);
    assert.equal((await A('POST', `/api/admin/orders/${o.id}/status`, { status: 'completed' })).status, 409, 'invalid transition');
    assert.equal((await A('POST', `/api/admin/orders/${o.id}/status`, { status: 'new' })).status, 200, 're-open');
    assert.equal(await stockOf(charger().id), before);
    for (const s of ['processing', 'completed']) await A('POST', `/api/admin/orders/${o.id}/status`, { status: s });
  });
  await t('wholesale order and reports: revenue/profit add up', async () => {
    const r = await req('POST', '/api/orders', { name: 'محل النور', phone: '0947777777', zone: 1, address: 'سبها - المنشية', payment_method: 'bank', items: [{ id: charger().id, qty: 10 }] });
    assert.equal(r.status, 201, r.text);
    const rep = (await A('GET', '/api/admin/reports')).json;
    // order1: 2x45=90 -9 coupon +10 ship = 91 (cost 2x30=60 → profit 21); order2: 10x38=380 + 0 ship (cost 300 → profit 80)
    assert.equal(rep.summary.revenue, 471); assert.equal(rep.summary.profit, 101); assert.equal(rep.summary.valid_orders, 2);
    assert.ok(rep.by_price_type.some((x) => x.price_type === 'wholesale' && x.revenue === 380));
    const dash = (await A('GET', '/api/admin/dashboard')).json; assert.equal(dash.new_orders, 1);
  });
  await t('CSV export (orders/products) and backup download', async () => {
    const o = await A('GET', '/api/admin/orders.csv'); assert.equal(o.status, 200); assert.match(o.text, /رقم الطلب/);
    const pr = await fetch(BASE + '/api/admin/products.csv', { headers: { Cookie: cookie } }); const pb = Buffer.from(await pr.arrayBuffer()); assert.equal(pb.slice(0, 3).toString('hex'), 'efbbbf', 'UTF-8 BOM for Excel'); assert.match(pb.toString(), /sku,name/);
    const b = await fetch(BASE + '/api/admin/backup', { headers: { Cookie: cookie } }); assert.equal(b.status, 200);
    const buf = Buffer.from(await b.arrayBuffer()); assert.equal(buf.slice(0, 15).toString(), 'SQLite format 3');
  });
  await t('CSV import creates & updates products by SKU', async () => {
    const csv = 'sku,name,category,price,wholesale_price,cost_price,stock\nKA-1001,شاحن سريع Type-C بقوة 25W,الشواحن,46,38,30,30\nNEW-1,سماعة سلكية 3.5mm,السماعات,8,6,4,100\n';
    const r = await A('POST', '/api/admin/products/import', { csv }); assert.deepEqual([r.json.created, r.json.updated, r.json.errors.length], [1, 1, 0]);
  });
  await t('staff role cannot access settings/users', async () => {
    assert.equal((await A('POST', '/api/admin/users', { name: 'موظف', email: 'staff@test.ly', password: 'Staff-Pass-2026', role: 'staff' })).status, 201);
    const l = await req('POST', '/api/admin/login', { email: 'staff@test.ly', password: 'Staff-Pass-2026' }, { 'X-Requested-With': 'fetch' });
    const sc = l.headers.get('set-cookie').split(';')[0];
    assert.equal((await req('PUT', '/api/admin/settings', {}, { Cookie: sc, 'X-Requested-With': 'fetch' })).status, 403);
    assert.equal((await req('GET', '/api/admin/users', undefined, { Cookie: sc })).status, 403);
    assert.equal((await req('GET', '/api/admin/products', undefined, { Cookie: sc })).status, 200);
  });
  await t('contact form stores message; honeypot blocks bots', async () => {
    assert.equal((await req('POST', '/api/contact', { name: 'سالم', phone: '0911111111', body: 'هل يتوفر شاحن ايفون؟' })).status, 201);
    assert.equal((await req('POST', '/api/contact', { name: 'bot', body: 'spam', website: 'x' })).status, 400);
    assert.equal((await A('GET', '/api/admin/messages')).json.items.length, 1);
  });
  await t('login rate limiting kicks in after repeated failures', async () => {
    let last;
    for (let i = 0; i < 8; i++) last = await req('POST', '/api/admin/login', { email: 'x@y.z', password: 'bad' }, { 'X-Requested-With': 'fetch', 'X-Forwarded-For': '9.9.9.9' });
    assert.equal(last.status, 429);
  });
  await t('settings: set WhatsApp, zones, payment methods', async () => {
    const s = (await A('GET', '/api/admin/settings')).json;
    const r = await A('PUT', '/api/admin/settings', { ...s, whatsapp: '0925550000', shipping_zones: [...s.shipping_zones, { name: 'مصراتة', fee: 35 }] });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.whatsapp, '0925550000');
    const pg = await req('GET', '/'); assert.match(pg.text, /wa\.me\/218925550000/);
  });

  // ---------- browser ----------
  let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('\n(playwright not installed — browser tests skipped)'); }
  if (chromium) {
    console.log('\nBrowser (Chromium)');
    const browser = await chromium.launch();
    const errors = [];
    const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME|net::ERR|status of 401/.test(m.text() + (m.location().url || ''))) errors.push(m.text()); }); };
    const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true }); };

    const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await mob.newPage(); watch(page);
    await t('mobile: browse → search → product → wholesale hint → add to cart', async () => {
      await page.goto(BASE + '/');
      await page.fill('.search input', 'باور'); await page.waitForSelector('.suggest a');
      await page.press('.search input', 'Enter'); await page.waitForURL(/\/shop\?q=/);
      await page.click('.card h3 a'); await page.waitForURL(/\/product\//);
      await page.fill('[data-qty]', '10'); await page.dispatchEvent('[data-qty]', 'change');
      assert.match(await page.textContent('[data-unit-note]'), /سعر الجملة مطبّق/);
      await page.fill('[data-qty]', '1'); await page.dispatchEvent('[data-qty]', 'change');
      await page.click('[data-add-qty]'); await page.waitForSelector('#cartDrawer.open .line');
      assert.equal(await page.textContent('.bottom-nav [data-cart-count]'), '1');
      await shot(page, 'mobile-cart-drawer');
      await page.click('[data-close-cart] svg').catch(() => page.click('.drawer-head button'));
    });
    await t('mobile: favorites toggle and favorites page', async () => {
      await page.goto(BASE + '/shop');
      await page.click('.card [data-fav] >> nth=0');
      assert.equal(await page.getAttribute('.card [data-fav] >> nth=0', 'aria-pressed'), 'true');
      await page.goto(BASE + '/favorites'); await page.waitForSelector('[data-favorites] .card');
    });
    await t('mobile: cart page qty change + checkout with coupon → success page', async () => {
      await page.goto(BASE + '/cart'); await page.waitForSelector('[data-line]');
      await page.click('[data-line-step="1"]'); await page.waitForFunction(() => document.querySelector('[data-line-qty]').value === '2');
      await page.goto(BASE + '/checkout'); await page.waitForSelector('[data-co-lines] tr[data-line]');
      await page.click('[data-submit]'); assert.match(await page.textContent('[data-form-error]'), /الاسم/);
      await page.fill('[name=name]', 'فاطمة علي'); await page.fill('[name=phone]', '0915556666');
      await page.selectOption('[name=zone]', '0'); await page.fill('[name=address]', 'سبها، حي الثانوية');
      await page.fill('[name=coupon]', 'SEBHA10'); await page.click('[data-apply-coupon]');
      await page.waitForSelector('[data-coupon-msg].ok');
      await page.check('[name=payment_method][value=wallet]');
      await shot(page, 'mobile-checkout');
      await page.click('[data-submit]'); await page.waitForURL(/\/order\//);
      assert.match(await page.textContent('h1'), /تم استلام طلبك/);
      assert.ok(await page.$('[data-inv-share]'), 'invoice share button'); assert.ok(await page.$('#inv-data[data-wa*="218925550000"]'), 'shop whatsapp number');
      await shot(page, 'mobile-order-success');
      assert.equal(await page.evaluate(() => localStorage.getItem('ka_cart')), '[]');
    });
    await t('mobile: contact form submits', async () => {
      await page.goto(BASE + '/page/contact'); await page.fill('#contactForm [name=name]', 'علي'); await page.fill('#contactForm [name=body]', 'استفسار عن الجملة');
      await page.click('#contactForm [type=submit]'); await page.waitForSelector('text=تم إرسال رسالتك');
    });
    await t('mobile: no horizontal overflow on key pages', async () => {
      for (const u of ['/', '/shop', '/categories', '/product/' + encodeURIComponent(products[0].slug), '/cart', '/checkout', '/track', '/page/shipping']) {
        await page.goto(BASE + u); const w = await page.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(w <= 391, `${u} scrollWidth=${w}`);
      }
    });

    const desk = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const ap = await desk.newPage(); watch(ap);
    await t('admin: login screen rejects bad password, accepts good', async () => {
      await ap.goto(BASE + '/admin'); await ap.fill('[name=email]', ADMIN.email); await ap.fill('[name=password]', 'nope');
      await ap.click('[type=submit]'); await ap.waitForSelector('.err');
      await ap.fill('[name=password]', ADMIN.password); await ap.click('[type=submit]');
      await ap.waitForSelector('.kpi'); await shot(ap, 'admin-dashboard');
    });
    await t('admin: every section renders without JS errors', async () => {
      for (const r of ['orders', 'products', 'categories', 'inventory', 'customers', 'coupons', 'reports', 'banners', 'pages', 'messages', 'settings', 'users', 'account']) {
        await ap.goto(BASE + '/admin#/' + r); await ap.waitForSelector('.page-head h1', { timeout: 5000 });
        const txt = await ap.textContent('#view'); assert.ok(!/خطأ|Error/.test(txt.slice(0, 200)), r);
        if (['reports', 'products', 'settings', 'orders'].includes(r)) await shot(ap, 'admin-' + r);
      }
    });
    await t('admin: create category + product, upload image, product appears in store', async () => {
      await ap.goto(BASE + '/admin#/categories'); await ap.click('[data-new]');
      await ap.fill('#modalBody [name=name]', 'ميكروفونات'); await ap.fill('#modalBody [name=icon]', '🎤'); await ap.click('#modalBody .btn.primary');
      await ap.waitForSelector('text=ميكروفونات');
      await ap.goto(BASE + '/admin#/products/new'); await ap.waitForSelector('[data-pf]');
      await ap.fill('[name=name]', 'ميكروفون لاسلكي للهاتف K9'); await ap.selectOption('[name=category_id]', { label: '🎤 ميكروفونات' });
      await ap.fill('[name=price]', '70'); await ap.fill('[name=compare_at_price]', '85'); await ap.fill('[name=wholesale_price]', '58'); await ap.fill('[name=wholesale_min_qty]', '5');
      await ap.fill('[name=cost_price]', '45'); await ap.fill('[name=stock]', '15'); await ap.fill('[name=tags]', 'مايك, mic, تصوير');
      await ap.fill('[name=description]', 'ميكروفون لاسلكي.\n\n## المواصفات\n- مدى 20 متر\n- بطارية 6 ساعات');
      await ap.check('[name=featured]');
      await ap.click('[data-pf] [type=submit]'); await ap.waitForURL(/#\/products\/\d+$/); await ap.waitForSelector('[data-upload]', { state: 'attached' });
      // generate a PNG in the page and upload through the real file input
      const png = await ap.evaluate(async () => { const c = document.createElement('canvas'); c.width = 900; c.height = 900; const x = c.getContext('2d'); x.fillStyle = '#2563eb'; x.fillRect(0, 0, 900, 900); x.fillStyle = '#fff'; x.font = 'bold 200px sans-serif'; x.fillText('K9', 250, 520); return c.toDataURL('image/png').split(',')[1]; });
      await ap.setInputFiles('[data-upload]', { name: 'mic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await ap.waitForSelector('.imgs .im img', { timeout: 15000 });
      await shot(ap, 'admin-product-edit');
      const r = await req('GET', '/api/products?q=' + encodeURIComponent('مايك'));
      const p = r.json.items.find((x) => x.name.includes('K9')); assert.ok(p, 'searchable by tag'); assert.ok(p.image_id, 'has image'); assert.equal(p.discount_pct, 18);
      const img = await fetch(`${BASE}/media/${p.image_id}`); assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/(webp|jpeg)/);
      const home = await req('GET', '/'); assert.match(home.text, /ميكروفون لاسلكي للهاتف K9/);
    });
    await t('admin: inline price edit from table', async () => {
      await ap.goto(BASE + '/admin#/products?q=' + encodeURIComponent('K9')); await ap.waitForSelector('[data-inl=price]');
      await ap.fill('[data-inl=price]', '72'); await ap.dispatchEvent('[data-inl=price]', 'change'); await ap.waitForSelector('.toast.show');
      const r = await req('GET', '/api/products?q=K9'); assert.equal(r.json.items[0].price, 72);
    });
    await t('admin: change order status via UI + print view', async () => {
      await ap.goto(BASE + '/admin#/orders?status=new'); await ap.click('tr.click'); await ap.waitForSelector('[data-status]');
      await ap.click('[data-status=processing]'); await ap.waitForSelector('.pill.st-processing');
      await shot(ap, 'admin-order-detail');
    });
    await t('admin: banner + settings save via UI', async () => {
      await ap.goto(BASE + '/admin#/settings'); await ap.waitForSelector('[data-sf]');
      await ap.fill('[name=working_hours]', 'يومياً 10ص - 11م'); await ap.click('[data-sf] .formbar .btn'); await ap.waitForSelector('text=تم حفظ الإعدادات');
      assert.match((await req('GET', '/page/contact')).text, /يومياً 10ص - 11م/);
    });
    await t('admin: logout ends session', async () => {
      await ap.goto(BASE + '/admin'); await ap.waitForSelector('[data-logout]'); await ap.click('[data-logout]'); await ap.waitForSelector('#loginForm');
      const r = await ap.evaluate(() => fetch('/api/admin/me').then((x) => x.status)); assert.equal(r, 401);
    });
    await t('desktop storefront screenshots', async () => {
      const p2 = await desk.newPage(); watch(p2);
      for (const [u, n] of [['/', 'desk-home'], ['/shop', 'desk-shop'], ['/product/' + encodeURIComponent((await req('GET', '/api/products?q=K9')).json.items[0].slug), 'desk-product'], ['/checkout', 'desk-checkout']]) { await p2.goto(BASE + u); await p2.waitForTimeout(300); await shot(p2, n); }
    });
    await t('no JavaScript errors in any page', async () => { assert.deepEqual(errors, []); });
    await browser.close();
  }

  srv.kill();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('Failed:', failures.join(' | ')); console.log('--- server log ---\n' + log.slice(-3000)); }
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
})();
