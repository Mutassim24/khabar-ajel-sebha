/* لوحة تحكم خبر عاجل سبها — admin SPA (vanilla JS, no dependencies) */
(() => {
  'use strict';
  // ---------- helpers ----------
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rv = (v) => (v === null || v === undefined || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(rv).join('') : esc(v));
  const h = (s, ...v) => new Raw(s.reduce((a, x, i) => a + x + (i < v.length ? rv(v[i]) : ''), ''));
  const raw = (s) => new Raw(String(s));
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const money = (v) => { const n = Math.round((Number(v) || 0) * 100) / 100; return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' د.ل'; };
  const num = (v) => (Number(v) || 0).toLocaleString('en-US');
  const dt = (iso, time = true) => iso ? new Date(iso).toLocaleString('ar-LY', { timeZone: 'Africa/Tripoli', year: 'numeric', month: 'short', day: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '—';
  const STATUS = { new: 'جديد', processing: 'قيد التجهيز', shipped: 'تم الشحن', completed: 'مكتمل', cancelled: 'ملغي' };
  const pill = (s) => h`<span class="pill st-${s}">${STATUS[s] || s}</span>`;
  const img = (id, w) => (id ? `/media/${id}${w ? '?w=' + w : ''}` : '');
  const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 864e5 + 2 * 3600e3).toISOString().slice(0, 10);

  async function api(method, url, body) {
    const opt = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(url, opt);
    let data = null; try { data = await res.json(); } catch {}
    if (res.status === 401 && !url.endsWith('/login')) { state.me = null; renderLogin(); throw new Error('انتهت الجلسة، سجّل الدخول مجدداً'); }
    if (!res.ok) { const e = new Error((data && data.error) || `خطأ ${res.status}`); e.data = data; throw e; }
    return data;
  }
  let tt;
  function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2800); }
  const fail = (e) => toast(e.message || 'حدث خطأ', true);

  // modal
  function modal(title, body, onMount) {
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = String(body); $('#modal').hidden = false;
    if (onMount) onMount($('#modalBody'));
  }
  const closeModal = () => { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close-modal]') || e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  function confirmBox(msg, okText = 'تأكيد', danger = true) {
    return new Promise((resolve) => {
      modal('تأكيد', h`<p style="margin-top:0">${msg}</p><div class="tools"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${okText}</button><button class="btn" data-no>إلغاء</button></div>`, (b) => {
        $('[data-ok]', b).onclick = () => { closeModal(); resolve(true); };
        $('[data-no]', b).onclick = () => { closeModal(); resolve(false); };
      });
    });
  }
  // form helpers
  function formData(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    }
    return o;
  }
  const showErr = (form, msg) => { let e = $('.err', form); if (!e) { e = document.createElement('div'); e.className = 'err'; form.prepend(e); } e.textContent = msg; e.hidden = !msg; if (msg) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

  // image resize in the browser -> base64 (full + thumbnail)
  async function encodeImage(file) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('الصيغة غير مدعومة: ' + file.name);
    if (file.size > 15 * 1024 * 1024) throw new Error('الصورة كبيرة جداً: ' + file.name);
    const bmp = await createImageBitmap(file);
    const draw = async (max, q) => {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
      let blob = await new Promise((r) => c.toBlob(r, 'image/webp', q));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      const buf = new Uint8Array(await blob.arrayBuffer()); let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { b64: btoa(bin), w: c.width, h: c.height, type: blob.type };
    };
    const full = await draw(1400, 0.85); const th = await draw(500, 0.8);
    return { data: full.b64, thumb: th.type === full.type ? th.b64 : undefined, width: full.w, height: full.h };
  }
  function download(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }

  // ---------- state & shell ----------
  const state = { me: null, badges: {} };
  const app = $('#app');
  const NAV = [
    ['dashboard', '📊', 'الرئيسية'], ['orders', '🧾', 'الطلبات', 'orders'], ['products', '📦', 'المنتجات'], ['categories', '🗂️', 'الأقسام'],
    ['inventory', '📋', 'حركة المخزون'], ['customers', '👥', 'العملاء'], ['coupons', '🎟️', 'كوبونات الخصم'], ['reports', '📈', 'التقارير والأرباح'],
    ['sep', '', 'المحتوى'], ['banners', '🖼️', 'البانرات'], ['pages', '📄', 'الصفحات'], ['messages', '✉️', 'الرسائل', 'messages'],
    ['sep', '', 'الإدارة'], ['settings', '⚙️', 'إعدادات المتجر', null, 'owner'], ['users', '🔐', 'المستخدمون', null, 'owner'], ['account', '👤', 'حسابي'],
  ];
  function renderShell() {
    app.innerHTML = String(h`<div class="shell">
      <aside class="side" id="side">
        <div class="brand"><span class="mark">خ</span><div><b>${state.me.store_name}</b><small>لوحة التحكم</small></div></div>
        <nav class="nav">${NAV.filter((n) => !n[4] || state.me.role === n[4]).map((n) => n[0] === 'sep' ? h`<div class="sep">${n[2]}</div>`
          : h`<a href="#/${n[0]}" data-nav="${n[0]}"><span class="ic">${n[1]}</span>${n[2]}${n[3] ? h`<span class="n" data-badge="${n[3]}" hidden></span>` : ''}</a>`)}</nav>
        <div class="side-foot"><b>${state.me.name}</b><span class="muted small">${state.me.role === 'owner' ? 'مالك المتجر' : 'موظف'} · ${state.me.email}</span><div style="margin-top:6px"><a href="/" target="_blank">عرض المتجر ↗</a><a href="#" data-logout>تسجيل الخروج</a></div></div>
      </aside>
      <div>
        <div class="topbar"><button type="button" data-menu aria-label="القائمة">☰</button><b>${state.me.store_name}</b><a href="/" target="_blank" style="color:#fff">المتجر ↗</a></div>
        <main class="main" id="view"></main>
      </div>
    </div>`);
    $('[data-logout]').onclick = async (e) => { e.preventDefault(); await api('POST', '/api/admin/logout').catch(() => {}); state.me = null; renderLogin(); };
    $('[data-menu]').onclick = () => $('#side').classList.toggle('open');
  }
  function setBadges(d) {
    if (d.new_orders !== undefined) state.badges.orders = d.new_orders;
    if (d.unread_messages !== undefined) state.badges.messages = d.unread_messages;
    $$('[data-badge]').forEach((b) => { const n = state.badges[b.dataset.badge]; b.hidden = !n; b.textContent = n; });
  }
  function renderLogin() {
    app.innerHTML = String(h`<div class="login"><form id="loginForm" novalidate>
      <div class="logo"><span class="mark">خ</span><div><h1>لوحة تحكم المتجر</h1><p>خبر عاجل سبها</p></div></div>
      <label class="l">البريد الإلكتروني<input name="email" type="email" autocomplete="username" required dir="ltr"></label>
      <label class="l">كلمة المرور<input name="password" type="password" autocomplete="current-password" required dir="ltr"></label>
      <button class="btn primary" type="submit" style="padding:11px">تسجيل الدخول</button>
      <a href="/" class="small" style="text-align:center">← العودة للمتجر</a>
    </form></div>`);
    const f = $('#loginForm');
    f.email.focus();
    f.onsubmit = async (e) => {
      e.preventDefault(); showErr(f, '');
      const btn = $('[type=submit]', f); btn.disabled = true;
      try { await api('POST', '/api/admin/login', formData(f)); await boot(); }
      catch (ex) { showErr(f, ex.message); btn.disabled = false; }
    };
  }

  // ---------- router ----------
  const routes = {};
  let view;
  async function route() {
    if (!state.me) return;
    const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0].split('/');
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const name = parts[0];
    $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
    $('#side')?.classList.remove('open');
    view = $('#view');
    const fresh = document.createElement('main'); fresh.className = 'main'; fresh.id = 'view';
    view.replaceWith(fresh); view = fresh;
    view.innerHTML = '<div class="empty">جارِ التحميل...</div>';
    const fn = routes[name] || routes.dashboard;
    try { await fn(view, parts.slice(1), qs); } catch (e) { view.innerHTML = String(h`<div class="card empty">${e.message}</div>`); }
    window.scrollTo(0, 0);
  }
  const setQs = (base, params) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) u.set(k, v); location.hash = `#/${base}${u.toString() ? '?' + u : ''}`; };
  const pager = (page, pages) => pages > 1 ? h`<div class="pager">${Array.from({ length: pages }, (_, i) => h`<button type="button" data-page="${i + 1}" class="${i + 1 === page ? 'on' : ''}">${i + 1}</button>`)}</div>` : '';
  const head = (title, sub, tools = '') => h`<div class="page-head"><div><h1>${title}</h1>${sub ? h`<div class="sub">${sub}</div>` : ''}</div><div class="tools">${tools}</div></div>`;

  // ---------- dashboard ----------
  function barChart(series, key = 'revenue', days = 14, endDate = today()) {
    const map = Object.fromEntries(series.map((s) => [s.day, s]));
    const pts = []; const end = new Date(endDate + 'T12:00:00Z');
    for (let i = days - 1; i >= 0; i--) { const d = new Date(end - i * 864e5).toISOString().slice(0, 10); pts.push({ d, v: map[d] ? map[d][key] : 0, o: map[d] ? map[d].orders : 0 }); }
    const max = Math.max(1, ...pts.map((p) => p.v)); const W = 700; const H = 200; const bw = W / pts.length;
    return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="رسم بياني للمبيعات">${pts.map((p, i) => {
      const bh = (p.v / max) * (H - 34); const x = W - (i + 1) * bw + bw * 0.18;
      return `<rect class="bar" x="${x}" y="${H - 20 - bh}" width="${bw * 0.64}" height="${Math.max(bh, p.v ? 2 : 0)}" rx="3"><title>${p.d}: ${money(p.v)} (${p.o} طلب)</title></rect>`
        + (pts.length <= 31 && (i % Math.ceil(pts.length / 14) === 0) ? `<text x="${x + bw * 0.32}" y="${H - 5}" text-anchor="middle">${p.d.slice(5).replace('-', '/')}</text>` : '');
    }).join('')}</svg>`);
  }
  routes.dashboard = async (v) => {
    const d = await api('GET', '/api/admin/dashboard'); setBadges(d);
    const k = (label, val, sub, cls = '') => h`<div class="kpi ${cls}"><small>${label}</small><b>${val}</b><span>${sub}</span></div>`;
    v.innerHTML = String(h`${head('لوحة التحكم', 'نظرة عامة على أداء المتجر', h`<a class="btn primary" href="#/products/new">+ منتج جديد</a><a class="btn" href="/" target="_blank">عرض المتجر ↗</a>`)}
      ${d.settings_incomplete ? h`<div class="alert warn"><span>⚠️ لم يتم تعيين رقم واتساب المتجر بعد — أزرار واتساب لن تظهر للعملاء.</span>${state.me.role === 'owner' ? h`<a class="btn sm" href="#/settings">إكمال الإعدادات</a>` : ''}</div>` : ''}
      ${d.new_orders ? h`<div class="alert info"><span>🛎️ لديك ${d.new_orders} طلب جديد بانتظار التأكيد</span><a class="btn sm primary" href="#/orders?status=new">عرض الطلبات الجديدة</a></div>` : ''}
      <div class="grid g4" style="margin-bottom:14px">
        ${k('مبيعات اليوم', money(d.today.revenue), `${d.today.valid_orders} طلب · ربح ${money(d.today.profit)}`, 'accent')}
        ${k('آخر 7 أيام', money(d.week.revenue), `${d.week.valid_orders} طلب · ربح ${money(d.week.profit)}`)}
        ${k('آخر 30 يوماً', money(d.month.revenue), `${d.month.valid_orders} طلب · ربح ${money(d.month.profit)}`)}
        ${k('متوسط قيمة الطلب', money(d.month.avg_order), 'خلال 30 يوماً')}
      </div>
      <div class="split">
        <div class="grid">
          <div class="card"><h2>المبيعات — آخر 14 يوماً <a class="small" href="#/reports">التقارير ←</a></h2>${barChart(d.series)}</div>
          <div class="card"><h2>أحدث الطلبات <a class="small" href="#/orders">كل الطلبات ←</a></h2>
            ${d.recent_orders.length ? h`<div class="tw" style="border:0"><table class="t"><thead><tr><th>رقم الطلب</th><th>العميل</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
              ${d.recent_orders.map((o) => h`<tr class="click" data-go="#/orders/${o.id}"><td class="ltr"><b>${o.number}</b></td><td>${o.customer_name}</td><td class="nowrap">${money(o.total)}</td><td>${pill(o.status)}</td><td class="small muted nowrap">${dt(o.created_at)}</td></tr>`)}
            </tbody></table></div>` : h`<div class="empty">لا توجد طلبات بعد</div>`}
          </div>
        </div>
        <div class="grid">
          <div class="card"><h2>المنتجات والمخزون</h2>
            <dl class="kv"><dt>إجمالي المنتجات</dt><dd>${num(d.products.total)} (${num(d.products.active)} معروض)</dd>
            <dt>نفد المخزون</dt><dd class="red">${num(d.products.out_of_stock)}</dd><dt>كمية منخفضة</dt><dd style="color:var(--amber)">${num(d.products.low_stock)}</dd>
            <dt>قيمة المخزون (تكلفة)</dt><dd>${money(d.products.stock_value)}</dd><dt>قيمة المخزون (بيع)</dt><dd>${money(d.products.stock_retail)}</dd><dt>العملاء</dt><dd>${num(d.customers)}</dd></dl>
          </div>
          <div class="card"><h2>تنبيهات المخزون <a class="small" href="#/products?status=low">عرض ←</a></h2>
            ${d.low_stock.length ? d.low_stock.map((p) => h`<div class="hbar" style="grid-template-columns:1fr auto"><a href="#/products/${p.id}"><span>${p.name}</span></a><span class="pill ${p.stock <= 0 ? 'p-out' : 'p-low'}">${p.stock <= 0 ? 'نفد' : 'متبقي ' + p.stock}</span></div>`) : h`<div class="empty small">كل المنتجات بمخزون جيد ✓</div>`}
          </div>
        </div>
      </div>`);
    v.onclick = (e) => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; };
  };

  // ---------- products ----------
  let categoriesCache = null;
  // <option>s grouped: parent, then indented subcategories
  const catOptions = (cats, selected) => cats.map((c) => h`<option value="${c.id}" ${c.id === Number(selected) ? 'selected' : ''}>${c.parent_id ? '　└ ' : ''}${c.parent_id ? '' : c.icon + ' '}${c.name}</option>`);
  const loadCats = async (force) => { if (!categoriesCache || force) categoriesCache = (await api('GET', '/api/admin/categories')).items; return categoriesCache; };
  routes.products = async (v, parts, qs) => {
    if (parts[0]) return productForm(v, parts[0]);
    const cats = await loadCats();
    const f = { q: qs.get('q') || '', category: qs.get('category') || '', status: qs.get('status') || '', sort: qs.get('sort') || '', page: qs.get('page') || '1' };
    const d = await api('GET', '/api/admin/products?' + new URLSearchParams(f));
    const selected = new Set();
    v.innerHTML = String(h`${head('المنتجات', `${num(d.total)} منتج`, h`<a class="btn primary" href="#/products/new">+ إضافة منتج</a><button class="btn" data-import>⬆ استيراد CSV</button><button class="btn" data-export>⬇ تصدير CSV</button>`)}
      <form class="filters" data-filter>
        <input class="f grow" name="q" placeholder="بحث بالاسم أو SKU أو الماركة..." value="${f.q}">
        <select class="f" name="category"><option value="">كل الأقسام</option>${catOptions(cats, f.category)}</select>
        <select class="f" name="status">${[['', 'كل الحالات'], ['noprice', 'بدون سعر'], ['active', 'معروض'], ['inactive', 'مخفي'], ['low', 'كمية منخفضة'], ['out', 'نفد المخزون'], ['featured', 'مميز'], ['sale', 'عليه خصم']].map(([k, l]) => h`<option value="${k}" ${k === f.status ? 'selected' : ''}>${l}</option>`)}</select>
        <select class="f" name="sort">${[['', 'الأحدث'], ['name', 'الاسم'], ['stock-asc', 'المخزون: الأقل'], ['price-desc', 'السعر: الأعلى'], ['sold', 'الأكثر مبيعاً']].map(([k, l]) => h`<option value="${k}" ${k === f.sort ? 'selected' : ''}>${l}</option>`)}</select>
        <button class="btn">تصفية</button>
      </form>
      <div class="bulk" data-bulk hidden><b data-sel-count></b>
        <select class="f" data-bulk-action><option value="">اختر إجراء...</option><option value="activate">إظهار في المتجر</option><option value="deactivate">إخفاء من المتجر</option><option value="feature">تمييز</option><option value="unfeature">إلغاء التمييز</option><option value="category">نقل إلى قسم...</option><option value="delete">حذف نهائي</option></select>
        <select class="f" data-bulk-cat hidden><option value="">بدون قسم</option>${catOptions(cats)}</select>
        <button class="btn sm orange" data-bulk-go>تطبيق</button>
      </div>
      ${d.items.length ? h`<div class="tw"><table class="t"><thead><tr><th><input type="checkbox" data-all aria-label="تحديد الكل"></th><th>المنتج</th><th>القسم</th><th>سعر القطاعي</th><th>سعر الجملة</th><th>التكلفة</th><th>المخزون</th><th>المبيعات</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${d.items.map((p) => h`<tr data-id="${p.id}">
          <td><input type="checkbox" data-sel="${p.id}"></td>
          <td><a class="pname" href="#/products/${p.id}">${p.image_id ? h`<img class="thumb" src="${img(p.image_id, 160)}" alt="">` : h`<span class="thumb">📦</span>`}<span><b>${p.name}</b><small class="ltr">${p.sku}</small></span></a></td>
          <td class="small">${p.category_name ? h`${p.parent_name ? h`<span class="muted">${p.parent_name} ›</span> ` : ''}${p.category_name}` : h`<span class="muted">—</span>`}</td>
          <td><input class="inl" type="number" min="0" step="0.01" value="${p.price}" data-inl="price" aria-label="سعر القطاعي">${p.price > 0 ? '' : h`<span class="pill p-low">بدون سعر</span>`}</td>
          <td><input class="inl" type="number" min="0" step="0.01" value="${p.wholesale_price ?? ''}" data-inl="wholesale_price" placeholder="—" aria-label="سعر الجملة">${p.wholesale_price ? h`<small class="muted">من ${p.wholesale_min_qty}</small>` : ''}</td>
          <td><input class="inl" type="number" min="0" step="0.01" value="${p.cost_price}" data-inl="cost_price" aria-label="التكلفة"></td>
          <td><input class="inl" style="width:70px" type="number" min="0" step="1" value="${p.stock}" data-inl="stock" aria-label="المخزون">${p.stock <= 0 ? h`<span class="pill p-out">نفد</span>` : p.stock <= p.low_stock_threshold ? h`<span class="pill p-low">منخفض</span>` : ''}</td>
          <td>${num(p.sold_count)}</td>
          <td class="nowrap"><span class="pill ${p.active ? 'p-on' : 'p-off'}">${p.active ? 'معروض' : 'مخفي'}</span>${p.featured ? h` <span class="pill p-ws">مميز</span>` : ''}${p.compare_at_price > p.price ? h` <span class="pill p-low">خصم</span>` : ''}</td>
          <td class="nowrap"><a class="btn sm" href="#/products/${p.id}">تعديل</a></td>
        </tr>`)}
      </tbody></table></div>${pager(d.page, d.pages)}` : h`<div class="card empty">لا توجد منتجات${f.q || f.status || f.category ? ' مطابقة' : ' بعد — ابدأ بإضافة أول منتج'}.<br><br><a class="btn primary" href="#/products/new">+ إضافة منتج</a></div>`}`);
    $('[data-filter]', v).onsubmit = (e) => { e.preventDefault(); setQs('products', formData(e.target)); };
    $$('[data-filter] select', v).forEach((s) => (s.onchange = () => setQs('products', formData(s.form))));
    v.addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p) setQs('products', { ...f, page: p.dataset.page }); });
    // inline edits
    v.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-inl]'); if (!inp) return;
      const id = inp.closest('tr').dataset.id; const k = inp.dataset.inl;
      const val = inp.value === '' ? null : Number(inp.value);
      try { await api('PATCH', `/api/admin/products/${id}`, { [k]: val }); toast('تم الحفظ ✓'); inp.style.color = 'var(--green)'; }
      catch (ex) { fail(ex); inp.style.color = 'var(--red)'; }
    });
    // selection + bulk
    const bulk = $('[data-bulk]', v);
    const upd = () => { bulk.hidden = !selected.size; $('[data-sel-count]', v).textContent = `${selected.size} محدد`; };
    v.addEventListener('change', (e) => {
      if (e.target.matches('[data-sel]')) { e.target.checked ? selected.add(Number(e.target.dataset.sel)) : selected.delete(Number(e.target.dataset.sel)); upd(); }
      if (e.target.matches('[data-all]')) { $$('[data-sel]', v).forEach((c) => { c.checked = e.target.checked; c.checked ? selected.add(Number(c.dataset.sel)) : selected.delete(Number(c.dataset.sel)); }); upd(); }
      if (e.target.matches('[data-bulk-action]')) $('[data-bulk-cat]', v).hidden = e.target.value !== 'category';
    });
    $('[data-bulk-go]', v).onclick = async () => {
      const action = $('[data-bulk-action]', v).value; if (!action) return toast('اختر إجراءً', true);
      if (action === 'delete' && !(await confirmBox(`حذف ${selected.size} منتج نهائياً؟ لا يمكن التراجع.`, 'حذف'))) return;
      try { await api('POST', '/api/admin/products/bulk', { ids: [...selected], action, category_id: $('[data-bulk-cat]', v).value || null }); toast('تم التنفيذ ✓'); route(); } catch (ex) { fail(ex); }
    };
    $('[data-export]', v).onclick = () => download('/api/admin/products.csv');
    $('[data-import]', v).onclick = () => modal('استيراد المنتجات من ملف CSV', h`
      <p class="small" style="margin-top:0">صدّر الملف الحالي أولاً لتحصل على القالب، ثم عدّله في Excel واحفظه بصيغة <b>CSV UTF-8</b>. المنتجات ذات رقم SKU الموجود تُحدَّث، والجديدة تُضاف. الأقسام غير الموجودة تُنشأ تلقائياً.</p>
      <p class="small muted">الأعمدة: sku, name, category, brand, price, compare_at_price, wholesale_price, wholesale_min_qty, cost_price, stock, active, featured, badge, tags, short_description, description</p>
      <input type="file" accept=".csv,text/csv" class="f" data-file style="width:100%"><div data-res style="margin-top:10px"></div>
      <div class="tools" style="margin-top:12px"><button class="btn primary" data-go>استيراد</button><button class="btn" data-close-modal>إغلاق</button></div>`, (b) => {
      $('[data-go]', b).onclick = async () => {
        const file = $('[data-file]', b).files[0]; if (!file) return toast('اختر ملفاً', true);
        try {
          const r = await api('POST', '/api/admin/products/import', { csv: await file.text() });
          $('[data-res]', b).innerHTML = String(h`<div class="alert info">تمت إضافة ${r.created} وتحديث ${r.updated} منتج.</div>${r.errors.length ? h`<div class="err">${r.errors.slice(0, 20).map((x) => h`<div>${x}</div>`)}</div>` : ''}`);
          categoriesCache = null;
        } catch (ex) { fail(ex); }
      };
    });
  };

  async function productForm(v, idParam) {
    const isNew = idParam === 'new';
    const cats = await loadCats(true);
    const p = isNew ? { active: 1, featured: 0, wholesale_min_qty: 10, low_stock_threshold: 3, stock: 0, cost_price: 0, images: [], movements: [], sku: (await api('GET', '/api/admin/products/next-sku')).sku } : await api('GET', `/api/admin/products/${idParam}`);
    const val = (x) => (x === null || x === undefined ? '' : x);
    v.innerHTML = String(h`${head(isNew ? 'إضافة منتج جديد' : 'تعديل المنتج', isNew ? '' : h`<span class="ltr">${p.sku}</span> · ${p.availability.label}`, h`<a class="btn" href="#/products">← كل المنتجات</a>${!isNew ? h`<a class="btn" href="/product/${p.slug}" target="_blank">عرض في المتجر ↗</a>` : ''}`)}
    <form class="form" data-pf novalidate>
      <div class="split">
        <div class="grid">
          <div class="card"><h2>المعلومات الأساسية</h2><div class="fg">
            <label class="l full">اسم المنتج *<input name="name" required maxlength="160" value="${val(p.name)}" placeholder="مثال: شاحن سامسونج أصلي 25W Type-C"></label>
            <label class="l">رقم المنتج SKU<input name="sku" dir="ltr" maxlength="60" value="${val(p.sku)}"><small>يُولَّد تلقائياً إن تُرك فارغاً</small></label>
            <label class="l">القسم<select name="category_id"><option value="">بدون قسم</option>${catOptions(cats, p.category_id)}</select><small>اختر النوع الفرعي إن وجد (مثلاً: الشواحن ← وصلة)</small></label>
            <label class="l">العلامة التجارية<input name="brand" maxlength="80" value="${val(p.brand)}" placeholder="Samsung, Anker, ..."></label>
            <label class="l">شارة على الصورة<input name="badge" maxlength="30" value="${val(p.badge)}" placeholder="جديد، الأكثر طلباً، أصلي"></label>
            <label class="l full">كلمات بحث إضافية<input name="tags" maxlength="400" value="${val(p.tags)}" placeholder="الموديلات المتوافقة وكلمات يبحث بها الزبائن: iPhone 15, ايفون, سامسونج A54"><small>تساعد البحث الذكي في إيجاد المنتج</small></label>
            <label class="l full">وصف مختصر<input name="short_description" maxlength="300" value="${val(p.short_description)}"></label>
            <label class="l full">الوصف التفصيلي<textarea name="description" rows="7" maxlength="10000" placeholder="اكتب المواصفات. لعمل قائمة ابدأ السطر بـ - ولعنوان فرعي ابدأ بـ ##">${val(p.description)}</textarea></label>
          </div></div>
          <div class="card"><h2>الصور <span class="small muted">أول صورة هي الرئيسية · حتى 12 صورة</span></h2>
            ${isNew ? h`<p class="muted small">احفظ المنتج أولاً ثم أضف الصور.</p>` : h`<div class="imgs" data-imgs>
              ${p.images.map((m, i) => h`<div class="im"><img src="${img(m, 300)}" alt="">${i === 0 ? h`<span class="first">رئيسية</span>` : ''}<div class="ops"><button type="button" data-img-first="${m}" title="اجعلها رئيسية">★</button><button type="button" data-img-left="${m}" title="تحريك">⇠</button><button type="button" data-img-del="${m}" title="حذف">🗑</button></div></div>`)}
              <label class="drop" data-drop>📷<br>اسحب الصور هنا أو اضغط للاختيار<input type="file" accept="image/*" multiple hidden data-upload></label>
            </div><p class="small muted" data-up-status></p>`}
          </div>
        </div>
        <div class="grid">
          <div class="card"><h2>الأسعار (د.ل)</h2><div class="fg">
            <label class="l">سعر القطاعي *<input name="price" type="number" min="0" step="0.01" required value="${val(p.price)}"></label>
            <label class="l">السعر قبل الخصم<input name="compare_at_price" type="number" min="0" step="0.01" value="${val(p.compare_at_price)}"><small>يظهر مشطوباً كعرض</small></label>
            <label class="l">سعر الجملة<input name="wholesale_price" type="number" min="0" step="0.01" value="${val(p.wholesale_price)}"></label>
            <label class="l">الجملة من كمية<input name="wholesale_min_qty" type="number" min="1" step="1" value="${val(p.wholesale_min_qty)}"></label>
            <label class="l full">سعر التكلفة (لحساب الأرباح)<input name="cost_price" type="number" min="0" step="0.01" value="${val(p.cost_price)}"><small>لا يظهر للعملاء</small></label>
            <div class="calc full" data-calc></div>
          </div></div>
          <div class="card"><h2>المخزون</h2><div class="fg">
            <label class="l">الكمية المتوفرة<input name="stock" type="number" min="0" step="1" value="${val(p.stock)}"></label>
            <label class="l">تنبيه عند وصولها إلى<input name="low_stock_threshold" type="number" min="0" step="1" value="${val(p.low_stock_threshold)}"></label>
          </div>
          ${!isNew ? h`<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><input class="f" style="width:90px" type="number" step="1" placeholder="±كمية" data-adj-qty><input class="f" style="flex:1;min-width:120px" placeholder="السبب (توريد، تالف، جرد...)" data-adj-reason><button type="button" class="btn sm" data-adj>تسجيل حركة</button></div>
            <details style="margin-top:10px"><summary class="small" style="cursor:pointer;font-weight:700">سجل حركة المخزون (${p.movements.length})</summary>
            <table class="t small" style="margin-top:6px"><tbody>${p.movements.map((m) => h`<tr><td class="${m.change > 0 ? 'green' : 'red'} ltr"><b>${m.change > 0 ? '+' : ''}${m.change}</b></td><td>${m.reason}${m.ref ? h` <span class="ltr muted">${m.ref}</span>` : ''}</td><td>← ${m.stock_after}</td><td class="muted nowrap">${dt(m.created_at)}</td></tr>`)}</tbody></table></details>` : ''}
          </div>
          <div class="card"><h2>الظهور</h2>
            <label class="sw"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> معروض في المتجر</label>
            <label class="sw" style="margin-top:8px"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> منتج مميز (يظهر في الرئيسية)</label>
            ${!isNew ? h`<label class="l" style="margin-top:12px">رابط المنتج<input name="slug" dir="ltr" value="${p.slug}"></label>` : ''}
          </div>
        </div>
      </div>
      <div class="formbar"><button class="btn primary" type="submit">💾 ${isNew ? 'حفظ المنتج' : 'حفظ التعديلات'}</button>
        ${!isNew ? h`<button type="button" class="btn" data-dup>نسخ المنتج</button><button type="button" class="btn danger" data-del>حذف</button>` : ''}</div>
    </form>`);
    const form = $('[data-pf]', v);
    const calc = () => {
      const d = formData(form); const price = Number(d.price) || 0; const cost = Number(d.cost_price) || 0; const ws = Number(d.wholesale_price) || 0; const cmp = Number(d.compare_at_price) || 0;
      const m = (s) => (s && cost ? ` (${Math.round(((s - cost) / s) * 100)}%)` : '');
      $('[data-calc]', v).innerHTML = String(h`ربح القطعة قطاعي: <b>${money(price - cost)}</b>${m(price)}${ws ? h` · جملة: <b>${money(ws - cost)}</b>${m(ws)}` : ''}${cmp > price ? h` · خصم <b>${Math.round((1 - price / cmp) * 100)}%</b>` : ''}`);
    };
    form.addEventListener('input', calc); calc();
    form.onsubmit = async (e) => {
      e.preventDefault(); showErr(form, '');
      const d = formData(form);
      for (const k of ['compare_at_price', 'wholesale_price', 'category_id']) if (d[k] === '') d[k] = null;
      const btn = $('[type=submit]', form); btn.disabled = true;
      try {
        const r = isNew ? await api('POST', '/api/admin/products', d) : await api('PUT', `/api/admin/products/${p.id}`, d);
        toast('تم حفظ المنتج ✓');
        if (isNew) location.hash = `#/products/${r.id}`; else route();
      } catch (ex) { showErr(form, ex.message); btn.disabled = false; }
    };
    if (isNew) return;
    $('[data-del]', v).onclick = async () => { if (await confirmBox(`حذف المنتج «${p.name}» نهائياً؟ ستبقى الطلبات السابقة محفوظة.`, 'حذف')) { try { await api('DELETE', `/api/admin/products/${p.id}`); toast('تم الحذف'); location.hash = '#/products'; } catch (ex) { fail(ex); } } };
    $('[data-dup]', v).onclick = async () => { try { const r = await api('POST', `/api/admin/products/${p.id}/duplicate`); toast('تم إنشاء نسخة (مخفية) ✓'); location.hash = `#/products/${r.id}`; } catch (ex) { fail(ex); } };
    $('[data-adj]', v).onclick = async () => {
      const change = Number($('[data-adj-qty]', v).value); if (!change) return toast('أدخل كمية موجبة أو سالبة', true);
      try { await api('POST', `/api/admin/products/${p.id}/stock`, { change, reason: $('[data-adj-reason]', v).value || (change > 0 ? 'توريد' : 'خصم يدوي') }); toast('تم تحديث المخزون ✓'); route(); } catch (ex) { fail(ex); }
    };
    // images
    const status = $('[data-up-status]', v);
    async function upload(files) {
      let n = 0;
      for (const file of files) {
        status.textContent = `جارِ رفع ${++n} من ${files.length}...`;
        try { const enc = await encodeImage(file); await api('POST', `/api/admin/products/${p.id}/images`, enc); } catch (ex) { fail(ex); }
      }
      status.textContent = ''; toast('تم رفع الصور ✓'); route();
    }
    $('[data-upload]', v).onchange = (e) => upload([...e.target.files]);
    const drop = $('[data-drop]', v);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); };
    $('[data-imgs]', v).onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const order = [...p.images];
      try {
        if (b.dataset.imgDel) { if (!(await confirmBox('حذف هذه الصورة؟', 'حذف'))) return; await api('DELETE', `/api/admin/products/${p.id}/images/${b.dataset.imgDel}`); }
        else {
          const m = Number(b.dataset.imgFirst || b.dataset.imgLeft); const i = order.indexOf(m); order.splice(i, 1);
          if (b.dataset.imgFirst) order.unshift(m); else order.splice(Math.min(i + 1, order.length), 0, m);
          await api('PUT', `/api/admin/products/${p.id}/images`, { order });
        }
        route();
      } catch (ex) { fail(ex); }
    };
  }

  // ---------- categories ----------
  routes.categories = async (v) => {
    const cats = await loadCats(true);
    v.innerHTML = String(h`${head('الأقسام', `${cats.length} قسم`, h`<button class="btn primary" data-new>+ قسم جديد</button>`)}
      <div class="tw"><table class="t"><thead><tr><th>الترتيب</th><th>القسم</th><th>الوصف</th><th>المنتجات</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${cats.map((c) => h`<tr style="${c.parent_id ? '' : 'background:#f7f9fc'}"><td>${c.sort_order}</td><td>${c.parent_id ? h`<span style="padding-inline-start:22px">└ ${c.name}</span>` : h`<b>${c.icon} ${c.name}</b>`}<br><small class="muted ltr">/category/${c.slug}</small></td><td class="small">${c.description || '—'}</td><td><a href="#/products?category=${c.id}">${c.total_products}</a></td><td><span class="pill ${c.active ? 'p-on' : 'p-off'}">${c.active ? 'ظاهر' : 'مخفي'}</span></td>
        <td class="nowrap"><button class="btn sm" data-edit="${c.id}">تعديل</button> <button class="btn sm danger" data-del="${c.id}">حذف</button></td></tr>`)}
      </tbody></table></div>`);
    const edit = (c = { active: 1, icon: '📦', sort_order: 0 }) => modal(c.id ? 'تعديل القسم' : 'قسم جديد', h`<form class="form" novalidate><div class="fg">
      <label class="l">اسم القسم *<input name="name" required value="${c.name || ''}"></label>
      <label class="l">يتبع القسم الرئيسي<select name="parent_id"><option value="">— قسم رئيسي —</option>${cats.filter((x) => !x.parent_id && x.id !== c.id).map((x) => h`<option value="${x.id}" ${x.id === c.parent_id ? 'selected' : ''}>${x.icon} ${x.name}</option>`)}</select><small>اختر قسماً رئيسياً لجعل هذا نوعاً فرعياً</small></label>
      <label class="l">أيقونة (إيموجي)<input name="icon" maxlength="8" value="${c.icon || ''}"></label>
      <label class="l full">وصف قصير<input name="description" maxlength="200" value="${c.description || ''}"></label>
      <label class="l">ترتيب الظهور<input name="sort_order" type="number" min="0" value="${c.sort_order ?? 0}"></label>
      ${c.id ? h`<label class="l">الرابط<input name="slug" dir="ltr" value="${c.slug}"></label>` : ''}
      <label class="sw full"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> ظاهر في المتجر</label></div>
      <div class="tools"><button class="btn primary">حفظ</button><button type="button" class="btn" data-close-modal>إلغاء</button></div></form>`, (b) => {
      const f = $('form', b); f.name.focus();
      f.onsubmit = async (e) => { e.preventDefault(); const dd = formData(f); dd.parent_id = dd.parent_id ? Number(dd.parent_id) : null; try { await api(c.id ? 'PUT' : 'POST', `/api/admin/categories${c.id ? '/' + c.id : ''}`, dd); closeModal(); toast('تم الحفظ ✓'); categoriesCache = null; route(); } catch (ex) { showErr(f, ex.message); } };
    });
    $('[data-new]', v).onclick = () => edit();
    v.onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) edit(cats.find((c) => c.id === Number(ed.dataset.edit)));
      const del = e.target.closest('[data-del]');
      if (del) { const c = cats.find((x) => x.id === Number(del.dataset.del)); if (await confirmBox(`حذف قسم «${c.name}»؟ ${c.parent_id ? '' : 'سيتم حذف أقسامه الفرعية أيضاً. '}المنتجات التابعة (${c.total_products}) ستبقى بدون قسم.`, 'حذف')) { try { await api('DELETE', `/api/admin/categories/${c.id}`); route(); } catch (ex) { fail(ex); } } }
    };
  };

  // ---------- inventory ----------
  routes.inventory = async (v) => {
    const d = await api('GET', '/api/admin/inventory');
    v.innerHTML = String(h`${head('حركة المخزون', 'آخر 200 حركة (توريد، بيع، إلغاء، تعديل)', h`<a class="btn" href="#/products?status=low">المنتجات المنخفضة</a>`)}
      <div class="tw"><table class="t"><thead><tr><th>التاريخ</th><th>المنتج</th><th>التغيير</th><th>الرصيد بعد</th><th>السبب</th><th>المرجع</th><th>بواسطة</th></tr></thead><tbody>
      ${d.items.length ? d.items.map((m) => h`<tr><td class="small nowrap">${dt(m.created_at)}</td><td><a href="#/products/${m.product_id}">${m.name}</a> <small class="muted ltr">${m.sku}</small></td><td class="ltr ${m.change > 0 ? 'green' : 'red'}"><b>${m.change > 0 ? '+' : ''}${m.change}</b></td><td>${m.stock_after}</td><td>${m.reason}</td><td class="ltr small">${m.ref || ''}</td><td class="small">${m.admin_name || (m.ref ? 'الموقع' : '—')}</td></tr>`) : h`<tr><td colspan="7" class="empty">لا توجد حركات</td></tr>`}
      </tbody></table></div>`);
  };

  // ---------- orders ----------
  routes.orders = async (v, parts, qs) => {
    if (parts[0]) return orderDetail(v, parts[0]);
    const f = { status: qs.get('status') || '', q: qs.get('q') || '', from: qs.get('from') || '', to: qs.get('to') || '', page: qs.get('page') || '1' };
    const d = await api('GET', '/api/admin/orders?' + new URLSearchParams(f));
    const counts = Object.fromEntries(d.counts.map((c) => [c.status, c.n]));
    setBadges({ new_orders: counts.new || 0 });
    const all = d.counts.reduce((a, c) => a + c.n, 0);
    v.innerHTML = String(h`${head('الطلبات', `${num(d.total)} طلب`, h`<button class="btn" data-csv>⬇ تصدير CSV</button>`)}
      <div class="tabs">${[['', 'الكل', all], ...Object.entries(STATUS).map(([k, l]) => [k, l, counts[k] || 0])].map(([k, l, n]) => h`<a href="#/orders${k ? '?status=' + k : ''}" class="${f.status === k ? 'on' : ''}">${l}<i>${n}</i></a>`)}</div>
      <form class="filters" data-filter><input type="hidden" name="status" value="${f.status}">
        <input class="f grow" name="q" placeholder="بحث برقم الطلب أو الاسم أو الهاتف" value="${f.q}">
        <input class="f" type="date" name="from" value="${f.from}" aria-label="من تاريخ"><input class="f" type="date" name="to" value="${f.to}" aria-label="إلى تاريخ">
        <button class="btn">بحث</button>
      </form>
      ${d.items.length ? h`<div class="tw"><table class="t"><thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>العميل</th><th>المنطقة</th><th>القطع</th><th>الإجمالي</th><th>الدفع</th><th>الحالة</th></tr></thead><tbody>
        ${d.items.map((o) => h`<tr class="click" data-go="#/orders/${o.id}"><td class="ltr"><b>${o.number}</b></td><td class="small nowrap">${dt(o.created_at)}</td><td>${o.customer_name}<br><small class="muted ltr">${o.phone}</small></td><td class="small">${o.city}</td><td>${o.items}</td><td class="nowrap"><b>${money(o.total)}</b></td><td class="small">${o.payment_label}</td><td>${pill(o.status)}</td></tr>`)}
      </tbody></table></div>${pager(d.page, d.pages)}` : h`<div class="card empty">لا توجد طلبات${f.q || f.status ? ' مطابقة' : ' بعد'}.</div>`}`);
    $('[data-filter]', v).onsubmit = (e) => { e.preventDefault(); setQs('orders', formData(e.target)); };
    $('[data-csv]', v).onclick = () => download('/api/admin/orders.csv?' + new URLSearchParams(f));
    v.onclick = (e) => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; const p = e.target.closest('[data-page]'); if (p) setQs('orders', { ...f, page: p.dataset.page }); };
  };
  const NEXT_LABEL = { processing: '⏳ قيد التجهيز', shipped: '🚚 تم الشحن', completed: '✅ مكتمل', cancelled: '❌ إلغاء الطلب', new: '↩ إعادة كجديد' };
  async function orderDetail(v, id) {
    const o = await api('GET', `/api/admin/orders/${id}`);
    v.innerHTML = String(h`${head(h`طلب <span class="ltr">${o.number}</span>`, h`${pill(o.status)} · ${dt(o.created_at)}`, h`<a class="btn" href="#/orders">← الطلبات</a><button class="btn" data-print>🖨 طباعة الفاتورة</button>`)}
      <div class="split">
        <div class="grid">
          <div class="card no-print"><h2>تغيير الحالة</h2>
            <div class="tools">${o.transitions.map((s) => h`<button class="btn ${s === 'cancelled' ? 'danger' : s === 'completed' ? 'primary' : ''}" data-status="${s}">${NEXT_LABEL[s]}</button>`)}</div>
            <input class="f" style="width:100%;margin-top:8px" placeholder="ملاحظة مع تغيير الحالة (اختياري)" data-note>
            ${o.status !== 'cancelled' ? h`<p class="small muted" style="margin:8px 0 0">إلغاء الطلب يعيد الكميات إلى المخزون تلقائياً.</p>` : ''}
          </div>
          <div class="card">
            <div class="print-only" style="margin-bottom:12px"><h2 style="color:#0f2240">${state.me.store_name} — فاتورة</h2><div>رقم الطلب: <b class="ltr">${o.number}</b> · ${dt(o.created_at)}</div><div>العميل: ${o.customer_name} — <span class="ltr">${o.phone}</span> — ${o.city} — ${o.address}</div></div>
            <h2 class="no-print">المنتجات</h2>
            <div class="tw" style="border:0"><table class="t"><thead><tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th><th class="no-print">الربح</th></tr></thead><tbody>
            ${o.items.map((i) => h`<tr><td>${i.product_id ? h`<a href="#/products/${i.product_id}">${i.name}</a>` : i.name} <small class="muted ltr">${i.sku}</small>${i.price_type === 'wholesale' ? h` <span class="pill p-ws">جملة</span>` : ''}</td><td class="nowrap">${money(i.unit_price)}</td><td>${i.qty}</td><td class="nowrap"><b>${money(i.line_total)}</b></td><td class="nowrap no-print green">${money(i.line_total - i.cost_price * i.qty)}</td></tr>`)}
            </tbody></table></div>
            <table class="totals" style="margin-inline-start:auto;margin-top:8px"><tbody>
              <tr><td>المجموع</td><td>${money(o.subtotal)}</td></tr>
              ${o.discount ? h`<tr><td>الخصم <span class="ltr">${o.coupon_code || ''}</span></td><td class="green">-${money(o.discount)}</td></tr>` : ''}
              <tr><td>التوصيل</td><td>${money(o.shipping_fee)}</td></tr>
              <tr class="big"><td>الإجمالي</td><td>${money(o.total)}</td></tr>
              <tr class="no-print"><td class="muted">صافي الربح</td><td class="green"><b>${money(o.profit)}</b></td></tr>
            </tbody></table>
          </div>
        </div>
        <div class="grid">
          <div class="card"><h2>العميل</h2>
            <dl class="kv"><dt>الاسم</dt><dd>${o.customer_id ? h`<a href="#/customers/${o.customer_id}">${o.customer_name}</a>` : o.customer_name} ${o.customer_orders > 1 ? h`<span class="pill p-on">${o.customer_orders} طلبات</span>` : ''}</dd>
            <dt>الهاتف</dt><dd class="ltr" style="text-align:right"><a href="tel:${o.phone}">${o.phone}</a></dd><dt>المنطقة</dt><dd>${o.city}</dd><dt>العنوان</dt><dd>${o.address}</dd>
            <dt>الدفع</dt><dd>${o.payment_label}</dd>${o.notes ? h`<dt>ملاحظات</dt><dd>${o.notes}</dd>` : ''}</dl>
            <div class="tools no-print" style="margin-top:12px"><a class="btn green" href="${o.customer_whatsapp}" target="_blank" rel="noopener">💬 مراسلة العميل واتساب</a><a class="btn" href="tel:${o.phone}">📞 اتصال</a></div>
          </div>
          <div class="card no-print"><h2>ملاحظات داخلية</h2><textarea class="f" style="width:100%" rows="3" data-admin-notes placeholder="لا تظهر للعميل">${o.admin_notes || ''}</textarea><button class="btn sm" style="margin-top:6px" data-save-notes>حفظ الملاحظات</button></div>
          <div class="card no-print"><h2>سجل الطلب</h2><ul class="hist">${o.history.slice().reverse().map((x) => h`<li><b>${STATUS[x.status]}</b> <span class="muted small">${dt(x.created_at)}${x.admin_name ? ' · ' + x.admin_name : ''}</span>${x.note ? h`<div class="small">${x.note}</div>` : ''}</li>`)}</ul></div>
          ${state.me.role === 'owner' && o.status === 'cancelled' ? h`<button class="btn danger no-print" data-del-order>حذف الطلب نهائياً</button>` : ''}
        </div>
      </div>`);
    $('[data-print]', v).onclick = () => window.print();
    $$('[data-status]', v).forEach((b) => (b.onclick = async () => {
      const s = b.dataset.status;
      if (s === 'cancelled' && !(await confirmBox('إلغاء هذا الطلب؟ ستعود الكميات إلى المخزون.', 'إلغاء الطلب'))) return;
      try { await api('POST', `/api/admin/orders/${o.id}/status`, { status: s, note: $('[data-note]', v).value }); toast(`تم تغيير الحالة إلى «${STATUS[s]}» ✓`); route(); } catch (ex) { fail(ex); }
    }));
    $('[data-save-notes]', v).onclick = async () => { try { await api('PUT', `/api/admin/orders/${o.id}/notes`, { admin_notes: $('[data-admin-notes]', v).value }); toast('تم الحفظ ✓'); } catch (ex) { fail(ex); } };
    const del = $('[data-del-order]', v);
    if (del) del.onclick = async () => { if (await confirmBox('حذف الطلب نهائياً من السجلات؟', 'حذف')) { try { await api('DELETE', `/api/admin/orders/${o.id}`); location.hash = '#/orders'; } catch (ex) { fail(ex); } } };
  }

  // ---------- customers ----------
  routes.customers = async (v, parts, qs) => {
    if (parts[0]) {
      const c = await api('GET', `/api/admin/customers/${parts[0]}`);
      v.innerHTML = String(h`${head(c.name, h`<span class="ltr">${c.phone}</span>`, h`<a class="btn" href="#/customers">← العملاء</a>`)}
        <div class="split"><div class="card"><h2>الطلبات (${c.orders.length}) — إجمالي المشتريات ${money(c.total_spent)}</h2>
          <div class="tw" style="border:0"><table class="t"><tbody>${c.orders.map((o) => h`<tr class="click" data-go="#/orders/${o.id}"><td class="ltr"><b>${o.number}</b></td><td>${money(o.total)}</td><td>${pill(o.status)}</td><td class="small muted">${dt(o.created_at)}</td></tr>`)}</tbody></table></div></div>
        <form class="card form" novalidate><h2>بيانات العميل</h2>
          <label class="l">الاسم<input name="name" value="${c.name}"></label><label class="l">المنطقة<input name="city" value="${c.city || ''}"></label>
          <label class="l">العنوان<input name="address" value="${c.address || ''}"></label>
          <label class="l">النوع<select name="type"><option value="retail" ${c.type === 'retail' ? 'selected' : ''}>قطاعي</option><option value="wholesale" ${c.type === 'wholesale' ? 'selected' : ''}>تاجر جملة</option></select></label>
          <label class="l">ملاحظات<textarea name="notes">${c.notes || ''}</textarea></label><button class="btn primary">حفظ</button></form></div>`);
      v.onclick = (e) => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; };
      $('form', v).onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', `/api/admin/customers/${c.id}`, formData(e.target)); toast('تم الحفظ ✓'); } catch (ex) { showErr(e.target, ex.message); } };
      return;
    }
    const f = { q: qs.get('q') || '', type: qs.get('type') || '', page: qs.get('page') || '1' };
    const d = await api('GET', '/api/admin/customers?' + new URLSearchParams(f));
    v.innerHTML = String(h`${head('العملاء', `${num(d.total)} عميل — يُضاف العميل تلقائياً عند أول طلب`, h`<button class="btn" data-csv>⬇ تصدير CSV</button>`)}
      <form class="filters" data-filter><input class="f grow" name="q" placeholder="بحث بالاسم أو الهاتف" value="${f.q}"><select class="f" name="type"><option value="">الكل</option><option value="retail" ${f.type === 'retail' ? 'selected' : ''}>قطاعي</option><option value="wholesale" ${f.type === 'wholesale' ? 'selected' : ''}>تجار جملة</option></select><button class="btn">بحث</button></form>
      ${d.items.length ? h`<div class="tw"><table class="t"><thead><tr><th>العميل</th><th>الهاتف</th><th>المنطقة</th><th>النوع</th><th>الطلبات</th><th>إجمالي المشتريات</th><th>آخر طلب</th></tr></thead><tbody>
      ${d.items.map((c) => h`<tr class="click" data-go="#/customers/${c.id}"><td><b>${c.name}</b></td><td class="ltr">${c.phone}</td><td class="small">${c.city || ''}</td><td>${c.type === 'wholesale' ? h`<span class="pill p-ws">جملة</span>` : 'قطاعي'}</td><td>${c.orders_count}</td><td class="nowrap">${money(c.total_spent)}</td><td class="small muted">${dt(c.last_order_at, false)}</td></tr>`)}
      </tbody></table></div>${pager(d.page, d.pages)}` : h`<div class="card empty">لا يوجد عملاء بعد.</div>`}`);
    $('[data-filter]', v).onsubmit = (e) => { e.preventDefault(); setQs('customers', formData(e.target)); };
    $('[data-csv]', v).onclick = () => download('/api/admin/customers.csv');
    v.onclick = (e) => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; const p = e.target.closest('[data-page]'); if (p) setQs('customers', { ...f, page: p.dataset.page }); };
  };

  // ---------- coupons ----------
  routes.coupons = async (v) => {
    const d = await api('GET', '/api/admin/coupons');
    const now = new Date().toISOString();
    const state2 = (c) => !c.active ? ['p-off', 'معطل'] : c.ends_at && c.ends_at < now ? ['p-out', 'منتهي'] : c.usage_limit && c.used_count >= c.usage_limit ? ['p-out', 'مستنفد'] : c.starts_at && c.starts_at > now ? ['p-low', 'لم يبدأ'] : ['p-on', 'فعّال'];
    v.innerHTML = String(h`${head('كوبونات الخصم', 'يُدخلها العميل في صفحة إتمام الطلب', h`<button class="btn primary" data-new>+ كوبون جديد</button>`)}
      ${d.items.length ? h`<div class="tw"><table class="t"><thead><tr><th>الكود</th><th>الخصم</th><th>الحد الأدنى</th><th>الاستخدام</th><th>الصلاحية</th><th>إجمالي الخصم</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${d.items.map((c) => { const s = state2(c); return h`<tr><td class="ltr"><b>${c.code}</b></td><td>${c.type === 'percent' ? c.value + '%' : money(c.value)}${c.max_discount ? h`<br><small class="muted">بحد أقصى ${money(c.max_discount)}</small>` : ''}</td><td>${c.min_order ? money(c.min_order) : '—'}</td><td>${c.used_count}${c.usage_limit ? ' / ' + c.usage_limit : ''}</td><td class="small">${c.starts_at ? dt(c.starts_at, false) : 'الآن'} ← ${c.ends_at ? dt(c.ends_at, false) : 'مفتوح'}</td><td>${money(c.total_discount)}</td><td><span class="pill ${s[0]}">${s[1]}</span></td><td class="nowrap"><button class="btn sm" data-edit="${c.id}">تعديل</button> <button class="btn sm danger" data-del="${c.id}">حذف</button></td></tr>`; })}
      </tbody></table></div>` : h`<div class="card empty">لا توجد كوبونات. أنشئ كوبوناً مثل <b class="ltr">SEBHA10</b> لخصم 10%.</div>`}`);
    const toDate = (iso) => (iso ? new Date(new Date(iso).getTime() + 2 * 3600e3).toISOString().slice(0, 10) : '');
    const edit = (c = { type: 'percent', active: 1 }) => modal(c.id ? 'تعديل الكوبون' : 'كوبون جديد', h`<form class="form" novalidate><div class="fg">
      <label class="l">الكود *<input name="code" dir="ltr" required value="${c.code || ''}" placeholder="SEBHA10" style="text-transform:uppercase"></label>
      <label class="l">النوع<select name="type"><option value="percent" ${c.type === 'percent' ? 'selected' : ''}>نسبة مئوية %</option><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>مبلغ ثابت د.ل</option></select></label>
      <label class="l">القيمة *<input name="value" type="number" step="0.01" min="0" required value="${c.value ?? ''}"></label>
      <label class="l">أقصى خصم (د.ل)<input name="max_discount" type="number" step="0.01" min="0" value="${c.max_discount ?? ''}"><small>للنسبة المئوية فقط</small></label>
      <label class="l">حد أدنى للطلب (د.ل)<input name="min_order" type="number" step="0.01" min="0" value="${c.min_order || ''}"></label>
      <label class="l">عدد مرات الاستخدام<input name="usage_limit" type="number" min="1" value="${c.usage_limit ?? ''}" placeholder="غير محدود"></label>
      <label class="l">يبدأ من<input name="starts_at" type="date" value="${toDate(c.starts_at)}"></label>
      <label class="l">ينتهي في<input name="ends_at" type="date" value="${toDate(c.ends_at)}"></label>
      <label class="sw full"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> مفعّل</label></div>
      <div class="tools"><button class="btn primary">حفظ</button><button type="button" class="btn" data-close-modal>إلغاء</button></div></form>`, (b) => {
      const f = $('form', b);
      f.onsubmit = async (e) => { e.preventDefault(); const dd = formData(f); for (const k of ['max_discount', 'usage_limit', 'starts_at', 'ends_at']) if (dd[k] === '') dd[k] = null; try { await api(c.id ? 'PUT' : 'POST', `/api/admin/coupons${c.id ? '/' + c.id : ''}`, dd); closeModal(); toast('تم الحفظ ✓'); route(); } catch (ex) { showErr(f, ex.message); } };
    });
    $('[data-new]', v).onclick = () => edit();
    v.onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) edit(d.items.find((c) => c.id === Number(ed.dataset.edit)));
      const del = e.target.closest('[data-del]'); if (del && (await confirmBox('حذف هذا الكوبون؟', 'حذف'))) { try { await api('DELETE', `/api/admin/coupons/${del.dataset.del}`); route(); } catch (ex) { fail(ex); } }
    };
  };

  // ---------- reports ----------
  routes.reports = async (v, parts, qs) => {
    const from = qs.get('from') || daysAgo(29); const to = qs.get('to') || today();
    const d = await api('GET', `/api/admin/reports?from=${from}&to=${to}`);
    const s = d.summary;
    const days = Math.round((new Date(d.range.to) - new Date(d.range.from)) / 864e5) + 1;
    const hbars = (rows, key = 'revenue', label = (r) => r.name) => { const max = Math.max(1, ...rows.map((r) => r[key])); return rows.length ? rows.map((r) => h`<div class="hbar"><span title="${label(r)}">${label(r)}</span><div class="tr"><i style="width:${(r[key] / max) * 100}%"></i></div><b class="nowrap">${money(r[key])}</b></div>`) : h`<div class="empty small">لا توجد بيانات</div>`; };
    const preset = (n, l) => h`<a class="btn sm" href="#/reports?from=${daysAgo(n - 1)}&to=${today()}">${l}</a>`;
    v.innerHTML = String(h`${head('التقارير والأرباح', `من ${d.range.from} إلى ${d.range.to}`, h`${preset(1, 'اليوم')}${preset(7, '7 أيام')}${preset(30, '30 يوماً')}${preset(90, '90 يوماً')}${preset(365, 'سنة')}`)}
      <form class="filters" data-range><input class="f" type="date" name="from" value="${d.range.from}"><input class="f" type="date" name="to" value="${d.range.to}"><button class="btn">عرض</button><button type="button" class="btn" data-csv>⬇ تصدير طلبات الفترة</button></form>
      <div class="grid g4" style="margin-bottom:14px">
        <div class="kpi accent"><small>إجمالي المبيعات (شامل التوصيل)</small><b>${money(s.revenue)}</b><span>${s.valid_orders} طلب غير ملغي</span></div>
        <div class="kpi"><small>صافي مبيعات المنتجات</small><b>${money(s.net_sales)}</b><span>بعد الخصومات ${money(s.discounts)}</span></div>
        <div class="kpi"><small>إجمالي الربح</small><b class="green">${money(s.profit)}</b><span>هامش ${s.net_sales ? Math.round((s.profit / s.net_sales) * 100) : 0}% · المحقق (مكتمل) ${money(s.realized_profit)}</span></div>
        <div class="kpi"><small>تكلفة البضاعة المباعة</small><b>${money(s.cost)}</b><span>${num(s.items_sold)} قطعة مباعة</span></div>
        <div class="kpi"><small>متوسط قيمة الطلب</small><b>${money(s.avg_order)}</b><span>رسوم توصيل محصلة ${money(s.shipping)}</span></div>
        <div class="kpi"><small>الطلبات المكتملة</small><b>${num(s.completed)}</b><span>من أصل ${num(s.orders)} طلب</span></div>
        <div class="kpi"><small>الطلبات الملغاة</small><b class="red">${num(s.cancelled)}</b><span>${s.orders ? Math.round((s.cancelled / s.orders) * 100) : 0}% من الطلبات</span></div>
        <div class="kpi"><small>جملة / قطاعي</small><b>${d.by_price_type.map((x) => `${x.price_type === 'wholesale' ? 'جملة' : 'قطاعي'} ${money(x.revenue)}`).join(' · ') || '—'}</b><span>حسب نوع السعر</span></div>
      </div>
      <div class="card" style="margin-bottom:14px"><h2>المبيعات اليومية</h2>${days <= 120 ? barChart(d.series, 'revenue', days, d.range.to) : h`<p class="muted">اختر فترة أقصر من 120 يوماً لعرض الرسم اليومي.</p>`}</div>
      <div class="grid g2">
        <div class="card"><h2>الأكثر مبيعاً</h2>${d.top_products.length ? h`<table class="t small"><thead><tr><th>المنتج</th><th>الكمية</th><th>المبيعات</th><th>الربح</th></tr></thead><tbody>${d.top_products.map((p) => h`<tr><td>${p.name}</td><td>${p.qty}</td><td class="nowrap">${money(p.revenue)}</td><td class="nowrap green">${money(p.profit)}</td></tr>`)}</tbody></table>` : h`<div class="empty small">لا توجد مبيعات في هذه الفترة</div>`}</div>
        <div class="card"><h2>المبيعات حسب القسم</h2>${hbars(d.by_category)}</div>
        <div class="card"><h2>حسب طريقة الدفع</h2>${hbars(d.by_payment)}</div>
        <div class="card"><h2>حسب منطقة التوصيل</h2>${hbars(d.by_zone)}</div>
        <div class="card"><h2>حالات الطلبات</h2>${d.by_status.map((x) => h`<div class="hbar" style="grid-template-columns:1fr auto auto">${pill(x.status)}<span>${x.n} طلب</span><b>${money(x.total)}</b></div>`)}</div>
        <div class="card"><h2>استخدام الكوبونات</h2>${d.coupons.length ? d.coupons.map((c) => h`<div class="hbar" style="grid-template-columns:1fr auto auto"><b class="ltr">${c.code}</b><span>${c.orders} طلب</span><span class="red">-${money(c.discount)}</span></div>`) : h`<div class="empty small">لا يوجد</div>`}</div>
      </div>`);
    $('[data-range]', v).onsubmit = (e) => { e.preventDefault(); setQs('reports', formData(e.target)); };
    $('[data-csv]', v).onclick = () => download(`/api/admin/orders.csv?from=${d.range.from}&to=${d.range.to}`);
  };

  // ---------- banners ----------
  const THEMES = { navy: 'أزرق داكن', orange: 'برتقالي', teal: 'فيروزي', dark: 'أسود' };
  routes.banners = async (v) => {
    const d = await api('GET', '/api/admin/banners');
    v.innerHTML = String(h`${head('البانرات الإعلانية', 'تظهر في أعلى الصفحة الرئيسية كشرائح متحركة', h`<button class="btn primary" data-new>+ بانر جديد</button>`)}
      <div class="grid g2">${d.items.map((b) => h`<div class="card"><div style="border-radius:12px;overflow:hidden;margin-bottom:10px;aspect-ratio:3/1;background:${b.theme === 'orange' ? '#d65a05' : b.theme === 'teal' ? '#0e6a6b' : b.theme === 'dark' ? '#1e2635' : '#173d73'};display:grid;place-items:center;color:#fff;position:relative">${b.media_id ? h`<img src="${img(b.media_id)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.8">` : ''}<b style="position:relative;padding:10px;text-align:center">${b.title}</b></div>
        <div class="small muted">${b.subtitle || ''}</div><div class="small">زر: ${b.cta_text || '—'} → <span class="ltr">${b.link || ''}</span></div>
        <div class="tools" style="margin-top:8px"><span class="pill ${b.active ? 'p-on' : 'p-off'}">${b.active ? 'ظاهر' : 'مخفي'}</span><span class="small muted">ترتيب ${b.sort_order}</span><button class="btn sm" data-edit="${b.id}">تعديل</button><button class="btn sm danger" data-del="${b.id}">حذف</button></div></div>`)}</div>
      ${d.items.length ? '' : h`<div class="card empty">لا توجد بانرات</div>`}`);
    const edit = (b = { theme: 'navy', active: 1, sort_order: d.items.length }) => modal(b.id ? 'تعديل البانر' : 'بانر جديد', h`<form class="form" novalidate><div class="fg">
      <label class="l full">العنوان *<input name="title" required maxlength="120" value="${b.title || ''}"></label>
      <label class="l full">النص الفرعي<input name="subtitle" maxlength="300" value="${b.subtitle || ''}"></label>
      <label class="l">نص الزر<input name="cta_text" maxlength="40" value="${b.cta_text || ''}" placeholder="تسوّق الآن"></label>
      <label class="l">رابط الزر<input name="link" dir="ltr" maxlength="300" value="${b.link || ''}" placeholder="/shop?sale=1"></label>
      <label class="l">اللون<select name="theme">${Object.entries(THEMES).map(([k, l]) => h`<option value="${k}" ${b.theme === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="l">الترتيب<input name="sort_order" type="number" min="0" value="${b.sort_order}"></label>
      <div class="full"><label class="l">صورة خلفية (اختياري — يُفضَّل 1600×600)<input type="file" accept="image/*" data-file></label><input type="hidden" name="media_id" value="${b.media_id || ''}"><div data-prev>${b.media_id ? h`<img src="${img(b.media_id)}" style="max-height:90px;border-radius:8px;margin-top:6px"> <button type="button" class="btn sm" data-rm-img>إزالة الصورة</button>` : ''}</div></div>
      <label class="sw full"><input type="checkbox" name="active" ${b.active ? 'checked' : ''}> ظاهر</label></div>
      <div class="tools"><button class="btn primary">حفظ</button><button type="button" class="btn" data-close-modal>إلغاء</button></div></form>`, (m) => {
      const f = $('form', m);
      $('[data-file]', m).onchange = async (e) => { const file = e.target.files[0]; if (!file) return; try { $('[data-prev]', m).textContent = 'جارِ الرفع...'; const r = await api('POST', '/api/admin/media', await encodeImage(file)); f.media_id.value = r.id; $('[data-prev]', m).innerHTML = `<img src="${img(r.id)}" style="max-height:90px;border-radius:8px;margin-top:6px">`; } catch (ex) { fail(ex); } };
      m.addEventListener('click', (e) => { if (e.target.closest('[data-rm-img]')) { f.media_id.value = ''; $('[data-prev]', m).innerHTML = ''; } });
      f.onsubmit = async (e) => { e.preventDefault(); const dd = formData(f); dd.media_id = dd.media_id ? Number(dd.media_id) : null; try { await api(b.id ? 'PUT' : 'POST', `/api/admin/banners${b.id ? '/' + b.id : ''}`, dd); closeModal(); toast('تم الحفظ ✓'); route(); } catch (ex) { showErr(f, ex.message); } };
    });
    $('[data-new]', v).onclick = () => edit();
    v.onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) edit(d.items.find((x) => x.id === Number(ed.dataset.edit)));
      const del = e.target.closest('[data-del]'); if (del && (await confirmBox('حذف هذا البانر؟', 'حذف'))) { await api('DELETE', `/api/admin/banners/${del.dataset.del}`).catch(fail); route(); }
    };
  };

  // ---------- pages ----------
  routes.pages = async (v, parts) => {
    const d = await api('GET', '/api/admin/pages');
    const cur = d.items.find((p) => p.slug === parts[0]) || d.items[0];
    v.innerHTML = String(h`${head('صفحات المتجر', 'من نحن، سياسة الخصوصية، الشحن والاستبدال، اتصل بنا')}
      <div class="tabs">${d.items.map((p) => h`<a href="#/pages/${p.slug}" class="${p.slug === cur.slug ? 'on' : ''}">${p.title}</a>`)}</div>
      <form class="card form" novalidate>
        <label class="l">عنوان الصفحة<input name="title" value="${cur.title}"></label>
        <label class="l">المحتوى<textarea name="content" rows="18">${cur.content}</textarea><small>للعناوين ابدأ السطر بـ ## وللقوائم ابدأ بـ - واترك سطراً فارغاً بين الفقرات. **نص** للخط العريض.</small></label>
        <div class="tools"><button class="btn primary">حفظ</button><a class="btn" href="/page/${cur.slug}" target="_blank">معاينة ↗</a><span class="small muted">آخر تحديث: ${dt(cur.updated_at)}</span></div>
      </form>`);
    $('form', v).onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', `/api/admin/pages/${cur.slug}`, formData(e.target)); toast('تم الحفظ ✓'); } catch (ex) { showErr(e.target, ex.message); } };
  };

  // ---------- messages ----------
  routes.messages = async (v) => {
    const d = await api('GET', '/api/admin/messages');
    setBadges({ unread_messages: d.items.filter((m) => !m.is_read).length });
    v.innerHTML = String(h`${head('رسائل العملاء', 'من نموذج صفحة اتصل بنا')}
      ${d.items.length ? d.items.map((m) => h`<div class="card" style="margin-bottom:10px;${m.is_read ? '' : 'border-color:#9cbcf7;background:#f7faff'}">
        <div class="card-h"><span>${m.is_read ? '' : '🔵 '}${m.name} ${m.phone ? h`<a class="small ltr" href="tel:${m.phone}">${m.phone}</a>` : ''}</span><span class="small muted">${dt(m.created_at)}</span></div>
        ${m.subject ? h`<b>${m.subject}</b>` : ''}<p style="white-space:pre-wrap;margin:6px 0">${m.body}</p>
        <div class="tools">${!m.is_read ? h`<button class="btn sm" data-read="${m.id}">تحديد كمقروءة</button>` : ''}${m.phone ? h`<a class="btn sm green" target="_blank" rel="noopener" href="https://wa.me/${m.phone.startsWith('0') ? '218' + m.phone.slice(1) : m.phone}">رد عبر واتساب</a>` : ''}<button class="btn sm danger" data-del="${m.id}">حذف</button></div></div>`) : h`<div class="card empty">لا توجد رسائل</div>`}`);
    v.onclick = async (e) => {
      const r = e.target.closest('[data-read]'); if (r) { await api('PUT', `/api/admin/messages/${r.dataset.read}/read`).catch(fail); route(); }
      const d2 = e.target.closest('[data-del]'); if (d2 && (await confirmBox('حذف الرسالة؟', 'حذف'))) { await api('DELETE', `/api/admin/messages/${d2.dataset.del}`).catch(fail); route(); }
    };
  };

  // ---------- settings ----------
  routes.settings = async (v) => {
    if (state.me.role !== 'owner') { v.innerHTML = '<div class="card empty">هذه الصفحة لمالك المتجر فقط</div>'; return; }
    const s = await api('GET', '/api/admin/settings');
    const zoneRow = (z = { name: '', fee: 0 }) => h`<div class="row" data-zone><input class="f" placeholder="اسم المنطقة" value="${z.name}" data-zn><input class="f" type="number" min="0" step="0.5" value="${z.fee}" data-zf aria-label="الرسوم"><button type="button" class="btn sm danger" data-rm>✕</button></div>`;
    const pmRow = (m) => h`<div class="row pm" data-pm="${m.id}"><input type="checkbox" ${m.enabled ? 'checked' : ''} data-pe aria-label="تفعيل"><input class="f" value="${m.name}" data-pn><input class="f" value="${m.instructions || ''}" data-pi placeholder="تعليمات للعميل"><span></span></div>`;
    v.innerHTML = String(h`${head('إعدادات المتجر', '')}
      <form class="form" novalidate data-sf>
        <div class="grid g2">
          <div class="card"><h2>هوية المتجر</h2><div class="fg">
            <label class="l">اسم المتجر *<input name="store_name" value="${s.store_name}"></label>
            <label class="l">الشعار النصي<input name="tagline" value="${s.tagline}"></label>
            <div class="full"><label class="l">شعار المتجر (صورة مربعة PNG/WEBP)<input type="file" accept="image/*" data-logo></label><input type="hidden" name="logo_media_id" value="${s.logo_media_id || ''}">
              <div data-logo-prev style="margin-top:6px">${s.logo_media_id ? h`<img src="${img(s.logo_media_id)}" style="height:56px;border-radius:10px"> <button type="button" class="btn sm" data-logo-rm>إزالة واستخدام الشعار الافتراضي</button>` : h`<span class="small muted">يُستخدم الشعار الافتراضي (خ ⚡)</span>`}</div></div>
            <label class="l full">شريط الإعلان العلوي<input name="topline" value="${s.topline}"></label>
            <label class="l full">تنبيه مهم في أعلى الصفحات (اختياري)<input name="announcement" value="${s.announcement || ''}" placeholder="مثال: المحل مغلق يوم الجمعة"></label>
          </div></div>
          <div class="card"><h2>التواصل</h2><div class="fg">
            <label class="l">رقم واتساب الطلبات *<input name="whatsapp" dir="ltr" value="${s.whatsapp}" placeholder="0912345678"><small>تُرسل إليه الطلبات واستفسارات العملاء</small></label>
            <label class="l">هاتف المحل<input name="phone" dir="ltr" value="${s.phone}"></label>
            <label class="l">البريد الإلكتروني<input name="email" dir="ltr" value="${s.email}"></label>
            <label class="l">ساعات العمل<input name="working_hours" value="${s.working_hours}"></label>
            <label class="l full">العنوان<input name="address" value="${s.address}"></label>
            <label class="l">فيسبوك<input name="facebook" dir="ltr" value="${s.facebook}" placeholder="https://facebook.com/..."></label>
            <label class="l">إنستغرام<input name="instagram" dir="ltr" value="${s.instagram}" placeholder="https://instagram.com/..."></label>
            <label class="l">تيك توك<input name="tiktok" dir="ltr" value="${s.tiktok}" placeholder="https://tiktok.com/@..."></label>
          </div></div>
          <div class="card"><h2>مناطق ورسوم التوصيل (د.ل)</h2><div class="list-rows" data-zones>${(s.shipping_zones || []).map((z) => zoneRow(z))}</div>
            <button type="button" class="btn sm" data-add-zone>+ إضافة منطقة</button>
            <label class="l" style="margin-top:12px">توصيل مجاني للطلبات فوق (د.ل)<input name="free_shipping_over" type="number" min="0" value="${s.free_shipping_over || 0}"><small>0 = معطل</small></label></div>
          <div class="card"><h2>طرق الدفع</h2><div class="list-rows" data-pms>${(s.payment_methods || []).map(pmRow)}</div><p class="small muted">فعّل الطرق المتاحة لديك. الدفع الإلكتروني هنا يتم يدوياً (يتواصل معك العميل لإتمام التحويل).</p></div>
          <div class="card"><h2>الجملة و SEO</h2><div class="fg">
            <label class="l full">ملاحظة الجملة<input name="wholesale_note" value="${s.wholesale_note}"></label>
            <label class="l full">وصف المتجر لمحركات البحث<textarea name="seo_description" rows="3">${s.seo_description}</textarea></label>
            <label class="l full">رابط الموقع الرسمي<input name="site_url" dir="ltr" value="${s.site_url}" placeholder="https://www.khabar-sebha.ly"><small>يُستخدم في خريطة الموقع وروابط المشاركة بعد ربط الدومين</small></label>
          </div></div>
          <div class="card"><h2>النسخ الاحتياطي</h2><p class="small">قاعدة البيانات كاملة (المنتجات، الصور، الطلبات، العملاء) في ملف واحد. يُنصح بتنزيل نسخة أسبوعياً.</p><button type="button" class="btn" data-backup>⬇ تنزيل نسخة احتياطية</button></div>
        </div>
        <div class="formbar"><button class="btn primary">💾 حفظ الإعدادات</button></div>
      </form>`);
    const f = $('[data-sf]', v);
    $('[data-add-zone]', v).onclick = () => $('[data-zones]', v).insertAdjacentHTML('beforeend', String(zoneRow()));
    v.addEventListener('click', (e) => { const rm = e.target.closest('[data-rm]'); if (rm) rm.closest('[data-zone]').remove(); if (e.target.closest('[data-logo-rm]')) { f.logo_media_id.value = ''; $('[data-logo-prev]', v).innerHTML = '<span class="small muted">سيُستخدم الشعار الافتراضي بعد الحفظ</span>'; } });
    $('[data-logo]', v).onchange = async (e) => { const file = e.target.files[0]; if (!file) return; try { const r = await api('POST', '/api/admin/media', await encodeImage(file)); f.logo_media_id.value = r.id; $('[data-logo-prev]', v).innerHTML = `<img src="${img(r.id)}" style="height:56px;border-radius:10px"> <span class="small muted">احفظ الإعدادات لتطبيق الشعار</span>`; } catch (ex) { fail(ex); } };
    $('[data-backup]', v).onclick = () => download('/api/admin/backup');
    f.onsubmit = async (e) => {
      e.preventDefault(); showErr(f, '');
      const d = formData(f);
      for (const k of Object.keys(d)) if (k.startsWith('data-')) delete d[k];
      d.logo_media_id = d.logo_media_id ? Number(d.logo_media_id) : null;
      d.shipping_zones = $$('[data-zone]', v).map((r) => ({ name: $('[data-zn]', r).value, fee: $('[data-zf]', r).value })).filter((z) => z.name.trim());
      d.payment_methods = $$('[data-pm]', v).map((r) => ({ id: r.dataset.pm, name: $('[data-pn]', r).value, instructions: $('[data-pi]', r).value, enabled: $('[data-pe]', r).checked }));
      try { const r = await api('PUT', '/api/admin/settings', d); state.me.store_name = r.store_name; toast('تم حفظ الإعدادات ✓'); } catch (ex) { showErr(f, ex.message); }
    };
  };

  // ---------- users ----------
  routes.users = async (v) => {
    const d = await api('GET', '/api/admin/users');
    v.innerHTML = String(h`${head('مستخدمو لوحة التحكم', 'المالك: صلاحيات كاملة · الموظف: المنتجات والطلبات والعملاء دون الإعدادات والمستخدمين', h`<button class="btn primary" data-new>+ مستخدم جديد</button>`)}
      <div class="tw"><table class="t"><thead><tr><th>الاسم</th><th>البريد</th><th>الصلاحية</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead><tbody>
      ${d.items.map((u) => h`<tr><td><b>${u.name}</b>${u.id === state.me.id ? ' (أنت)' : ''}</td><td class="ltr">${u.email}</td><td>${u.role === 'owner' ? 'مالك' : 'موظف'}</td><td><span class="pill ${u.active ? 'p-on' : 'p-off'}">${u.active ? 'نشط' : 'معطل'}</span></td><td class="small muted">${dt(u.last_login_at)}</td><td class="nowrap"><button class="btn sm" data-edit="${u.id}">تعديل</button>${u.id !== state.me.id ? h` <button class="btn sm danger" data-del="${u.id}">حذف</button>` : ''}</td></tr>`)}
      </tbody></table></div>`);
    const edit = (u) => modal(u ? 'تعديل المستخدم' : 'مستخدم جديد', h`<form class="form" novalidate><div class="fg">
      <label class="l">الاسم *<input name="name" required value="${u ? u.name : ''}"></label>
      ${u ? '' : h`<label class="l">البريد الإلكتروني *<input name="email" type="email" dir="ltr" required></label>`}
      <label class="l">الصلاحية<select name="role"><option value="staff" ${u && u.role === 'staff' ? 'selected' : ''}>موظف</option><option value="owner" ${u && u.role === 'owner' ? 'selected' : ''}>مالك</option></select></label>
      <label class="l">${u ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور *'}<input name="password" type="password" dir="ltr" autocomplete="new-password" minlength="10"><small>10 أحرف على الأقل</small></label>
      ${u ? h`<label class="sw full"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> الحساب نشط</label>` : ''}</div>
      <div class="tools"><button class="btn primary">حفظ</button><button type="button" class="btn" data-close-modal>إلغاء</button></div></form>`, (m) => {
      const f = $('form', m);
      f.onsubmit = async (e) => { e.preventDefault(); const dd = formData(f); if (!dd.password) delete dd.password; try { await api(u ? 'PUT' : 'POST', `/api/admin/users${u ? '/' + u.id : ''}`, dd); closeModal(); toast('تم الحفظ ✓'); route(); } catch (ex) { showErr(f, ex.message); } };
    });
    $('[data-new]', v).onclick = () => edit(null);
    v.onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) edit(d.items.find((x) => x.id === Number(ed.dataset.edit)));
      const del = e.target.closest('[data-del]'); if (del && (await confirmBox('حذف هذا المستخدم؟', 'حذف'))) { await api('DELETE', `/api/admin/users/${del.dataset.del}`).catch(fail); route(); }
    };
  };

  // ---------- account ----------
  routes.account = async (v) => {
    v.innerHTML = String(h`${head('حسابي', `${state.me.name} · ${state.me.email}`)}
      <form class="card form" style="max-width:480px" novalidate><h2>تغيير كلمة المرور</h2>
        <label class="l">كلمة المرور الحالية<input name="current" type="password" dir="ltr" autocomplete="current-password"></label>
        <label class="l">كلمة المرور الجديدة<input name="next" type="password" dir="ltr" autocomplete="new-password" minlength="10"><small>10 أحرف على الأقل، يُفضّل خليط من الحروف والأرقام</small></label>
        <label class="l">تأكيد كلمة المرور الجديدة<input name="confirm" type="password" dir="ltr" autocomplete="new-password"></label>
        <button class="btn primary">تحديث كلمة المرور</button></form>`);
    $('form', v).onsubmit = async (e) => {
      e.preventDefault(); const d = formData(e.target);
      if (d.next !== d.confirm) return showErr(e.target, 'كلمتا المرور غير متطابقتين');
      try { await api('POST', '/api/admin/password', { current: d.current, next: d.next }); toast('تم تغيير كلمة المرور ✓'); e.target.reset(); showErr(e.target, ''); } catch (ex) { showErr(e.target, ex.message); }
    };
  };

  // ---------- boot ----------
  async function boot() {
    try { state.me = await api('GET', '/api/admin/me'); } catch { return renderLogin(); }
    renderShell();
    window.onhashchange = route;
    await route();
    api('GET', '/api/admin/dashboard').then(setBadges).catch(() => {});
  }
  boot();
})();
