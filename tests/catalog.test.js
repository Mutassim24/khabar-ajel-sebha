/* Tests for the real catalog: taxonomy, photos, Libyan/MSA search, price-on-request. Run: node tests/catalog.test.js */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const assert = require('assert/strict');

const PORT = 3800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-cat-'));
let passed = 0; const failed = [];
const t = async (n, fn) => { try { await fn(); passed++; console.log('  ✓', n); } catch (e) { failed.push(n); console.log('  ✗', n, '\n     ', e.message); } };
const j = async (u, opt) => (await fetch(BASE + u, opt)).json();
const q = (s) => encodeURIComponent(s);

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_EMAIL: 'o@t.ly', ADMIN_PASSWORD: 'Owner-Pass-2026' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  await t('catalog seeded: 119 real products, every one with a photo', async () => {
    const r = await j('/api/products?per=100');
    assert.equal(r.total, 119); assert.ok(r.items.every((p) => p.image_id), 'all have images');
  });
  await t('photos served as webp, thumbnails smaller than full size', async () => {
    const p = (await j('/api/products?per=1')).items[0];
    const full = await fetch(`${BASE}/media/${p.image_id}`); const th = await fetch(`${BASE}/media/${p.image_id}?w=480`);
    assert.equal(full.headers.get('content-type'), 'image/webp');
    assert.ok((await th.arrayBuffer()).byteLength < (await full.arrayBuffer()).byteLength);
  });
  await t('parent category includes its subcategories; subcategory filters', async () => {
    assert.equal((await j('/api/products?per=100&category=' + q('السماعات'))).total, 17);
    assert.equal((await j('/api/products?per=100&category=' + q('سماعة-رقبة'))).total, 3);
    assert.equal((await j('/api/products?per=100&category=' + q('باور-بنك'))).total, 9);
  });
  await t('Libyan dialect + MSA names find the same products', async () => {
    const names = async (s) => (await j('/api/products?per=50&q=' + q(s))).items.map((p) => p.name);
    const cables = (await j('/api/products?per=50&category=' + q('وصلة-خيط-شحن'))).items.map((p) => p.name);
    for (const word of ['خيط شحن', 'وصلة', 'كابل', 'كيبل']) { const r = await names(word); assert.ok(cables.every((c) => r.includes(c)), word); assert.ok(!r.some((n) => n.includes('هاندز')), word + ' no earphones'); }
    assert.ok((await names('ماكينة زيان')).length === 5);
    assert.ok((await names('جويستيك')).every((n) => n.includes('يد ')) && (await names('جويستيك')).length === 4);
    assert.ok(!(await names('ايفون')).some((n) => n.startsWith('وصلة') && n.includes('Type-C') && !n.includes('ايفون')), 'no substring false positives');
  });
  await t('product without price shows "السعر عند الطلب" and cannot be ordered', async () => {
    const p = (await j('/api/products?per=1')).items[0];
    assert.equal(p.availability.key, 'ask');
    const html = await (await fetch(`${BASE}/product/${q(p.slug)}`)).text();
    assert.match(html, /السعر عند الطلب/); assert.ok(!html.includes('data-add-qty'));
    const r = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'تجربة', phone: '0912345678', zone: 0, address: 'سبها', payment_method: 'cod', items: [{ id: p.id, qty: 1 }] }) });
    assert.equal(r.status, 409);
  });
  await t('admin sets a price → product becomes orderable; admin can add a subcategory', async () => {
    const login = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ email: 'o@t.ly', password: 'Owner-Pass-2026' }) });
    const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: login.headers.get('set-cookie').split(';')[0] };
    const p = (await j('/api/products?per=1&q=PQ30')).items[0];
    assert.equal((await fetch(`${BASE}/api/admin/products/${p.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ price: 95, stock: 4 }) })).status, 200);
    const q2 = await j('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: p.id, qty: 1 }] }) });
    assert.equal(q2.errors.length, 0); assert.equal(q2.subtotal, 95);
    const cats = (await j('/api/admin/categories', { headers: H })).items;
    const parent = cats.find((c) => c.name === 'الكفرات');
    const r = await fetch(BASE + '/api/admin/categories', { method: 'POST', headers: H, body: JSON.stringify({ name: 'كفر سيليكون', parent_id: parent.id, active: true }) });
    assert.equal(r.status, 201);
    const bad = await fetch(BASE + '/api/admin/categories', { method: 'POST', headers: H, body: JSON.stringify({ name: 'مستوى ثالث', parent_id: (await r.json()).id }) });
    assert.equal(bad.status, 400, 'only two levels');
  });
  await t('price sheet CSV (sku + price only) updates prices and keeps names/brands/photos', async () => {
    const login = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ email: 'o@t.ly', password: 'Owner-Pass-2026' }) });
    const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: login.headers.get('set-cookie').split(';')[0] };
    const csv = '\uFEFFsku,name,category,price,wholesale_price,wholesale_min_qty,cost_price,stock\r\nKA-2005,,,120,105,5,90,7\r\nKA-2006,,,,,10,,\r\n';
    const r = await (await fetch(BASE + '/api/admin/products/import', { method: 'POST', headers: H, body: JSON.stringify({ csv }) })).json();
    assert.deepEqual([r.updated, r.created, r.errors.length], [2, 0, 0], JSON.stringify(r));
    const p = (await j('/api/products?per=5&q=MX-HC326')).items[0];
    assert.equal(p.price, 120); assert.equal(p.wholesale_price, 105); assert.equal(p.stock, 7); assert.equal(p.brand, 'MOXOM'); assert.ok(p.image_id); assert.equal(p.availability.key, 'in');
  });
  await t('cables: connector filter (Type-C / ايفون / مايكرو) splits correctly', async () => {
    const cat = '&category=' + q('وصلة-خيط-شحن');
    const n = async (w) => (await j('/api/products?per=100' + cat + '&q=' + q(w))).items.map((p) => p.name);
    const all = (await j('/api/products?per=100' + cat)).items;
    const c = await n('تايب سي'); const i = await n('ايفون'); const m = await n('مايكرو');
    assert.equal(all.length, 18);
    assert.ok(m.every((x) => x.includes('مايكرو')) && m.length === 4, 'micro ' + m.length);
    console.log('      typec:', c.length, 'iphone:', i.length, 'micro:', m.length);
    assert.ok(i.length === 7 && i.every((x) => x.includes('ايفون')), 'iphone ' + i.length);
    assert.ok(c.length >= 8 && !c.some((x) => x.includes('مايكرو')), 'typec ' + c.length);
    const html = await (await fetch(`${BASE}/category/${q('وصلة-خيط-شحن')}`)).text(); assert.match(html, /نوع المدخل/);
  });
  await t('existing store picks up a new catalog batch on restart', async () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, ['-e', `process.env.DATA_DIR=${JSON.stringify(DATA)};const d=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db.js'))});d.run("UPDATE settings SET value='38' WHERE key='_catalog_seeded'");d.run("DELETE FROM products WHERE sku='KA-2054'");d.seed();console.log(d.get("SELECT COUNT(*) AS n FROM products WHERE sku='KA-2054'").n, d.get("SELECT COUNT(*) AS n FROM products").n)`]).toString().trim();
    assert.equal(out, '1 119');
  });
  await t('screen protectors: Libyan names + phone model find the right one', async () => {
    const n = async (w) => (await j('/api/products?per=50&q=' + q(w))).items.map((p) => p.name);
    assert.ok((await n('لاصقة S24 الترا'))[0].includes('S24'), 'لاصقة S24');
    assert.ok((await n('استيكر كامون 50'))[0].includes('كامون 50'), 'استيكر كامون 50');
    assert.ok((await n('ضد كسر ايفون 16')).some((x) => x.includes('16 برو ماكس')));
    assert.ok((await n('privacy')).length === 2);
    assert.ok((await n('مشغل سيارة'))[0].includes('GM-C05'));
  });
  await t('cases: type the phone model → every case type and colour for it', async () => {
    const n = async (w) => (await j('/api/products?per=50&q=' + q(w))).items.map((p) => p.name);
    const a35 = await n('كفر A35'); assert.equal(a35.length, 2); assert.ok(a35.some((x) => x.includes('بني')) && a35.some((x) => x.includes('أسود')));
    assert.equal((await n('جراب سبارك 40C')).length, 3);
    assert.equal((await n('spark 40c')).length, 3);
    assert.equal((await n('حافظة x7d')).length, 3);
    assert.equal((await n('كفر x7d موف'))[0].includes('بنفسجي'), true);
    assert.ok((await n('S24 الترا')).some((x) => x.includes('كفر')) && (await n('S24 الترا')).some((x) => x.includes('حماية')), 'case + screen protector for S24 Ultra');
    assert.equal((await j('/api/products?per=100&category=' + q('الكفرات'))).total, 40);
    const pm16 = await n('كفر ايفون 16 برو ماكس'); assert.equal(pm16.length, 5, pm16.join(' | '));
    assert.equal((await n('جراب s26 الترا')).length, 5);
    assert.equal((await n('كفر ماجسيف')).length, 15);
    assert.ok((await n('جراب S22')).length >= 3);
  });
  await t('store WhatsApp number is set: ask-price button opens wa.me/218926201329', async () => {
    const p = (await j('/api/products?per=1')).items[0];
    const html = await (await fetch(`${BASE}/product/${q(p.slug)}`)).text();
    assert.match(html, /data-whatsapp="218926201329,218928146639"/); assert.match(html, /عبر واتساب/);
    assert.match(html, /data-wa-num="218928146639"/, 'second number in the chooser'); assert.match(html, /data-ask/, 'quantity for price-on-request');
  });
  await t('categories show real product photos; theme toggle present', async () => {
    const html = await (await fetch(`${BASE}/categories`)).text();
    assert.ok((html.match(/class="cat-img"/g) || []).length >= 8); assert.match(html, /data-theme-toggle/);
    const sub = await (await fetch(`${BASE}/category/${q('الكفرات')}`)).text(); assert.match(sub, /class="subcats"[\s\S]*?<img/);
  });
  await t('re-processed photos replace untouched catalog photos in an existing store', async () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, ['-e', `process.env.DATA_DIR=${JSON.stringify(DATA)};const d=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db.js'))});const p=d.get("SELECT m.id,m.size FROM products p JOIN product_images pi ON pi.product_id=p.id JOIN media m ON m.id=pi.media_id WHERE p.sku='KA-2020'");const old=require(${JSON.stringify(path.join(__dirname, '..', 'seed', 'images-replaced.json'))})['p20-1.webp'];d.run("UPDATE media SET size=? WHERE id=?",old,p.id);d.run("DELETE FROM settings WHERE key='_catalog_photos'");d.seed();console.log(d.get("SELECT size FROM media WHERE id=?",p.id).size!==old)`]).toString().trim();
    assert.equal(out, 'true');
  });
  await t('category page shows subcategory chips', async () => {
    const html = await (await fetch(`${BASE}/category/${q('الشواحن')}`)).text();
    assert.match(html, /class="subcats"/); assert.match(html, /وصلة \(خيط شحن\)/);
  });

  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed.length} failed`); process.exit(failed.length ? 1 : 0);
})();
