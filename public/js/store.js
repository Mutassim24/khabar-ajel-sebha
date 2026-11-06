/* خبر عاجل سبها — storefront client script (no dependencies) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    return n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + ' د.ل';
  };
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  // migrate from the original prototype's keys
  if (!localStorage.getItem('ka_cart') && localStorage.getItem('mw_cart')) store.set('ka_cart', store.get('mw_cart', []));
  if (!localStorage.getItem('ka_favs') && localStorage.getItem('mw_favs')) store.set('ka_favs', store.get('mw_favs', []));

  let cart = store.get('ka_cart', []).filter((x) => x && Number.isInteger(x.id) && x.qty > 0);
  let favs = store.get('ka_favs', []).filter(Number.isInteger);
  const saveCart = () => { store.set('ka_cart', cart); syncCounts(); };
  const saveFavs = () => { store.set('ka_favs', favs); syncCounts(); syncFavButtons(); };

  async function api(url, body) {
    let res;
    try { res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(body) } : {}); }
    catch { throw new Error('تعذّر الاتصال بالإنترنت، تأكد من الشبكة وحاول مرة أخرى'); }
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error((data && data.error) || 'حدث خطأ في الخادم، حاول مرة أخرى'); e.data = data; e.status = res.status; throw e; }
    return data;
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, err) {
    const t = $('.toast'); if (!t) return;
    t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- counts ----------
  function syncCounts() {
    const n = cart.reduce((a, x) => a + x.qty, 0);
    $$('[data-cart-count]').forEach((el) => { el.textContent = n > 99 ? '99+' : n; el.hidden = !n; });
    $$('[data-fav-count]').forEach((el) => { el.textContent = favs.length; el.hidden = !favs.length; });
  }
  function syncFavButtons() {
    $$('[data-fav]').forEach((b) => {
      const on = favs.includes(Number(b.dataset.fav));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'إزالة من المفضلة' : 'أضف إلى المفضلة');
    });
  }

  // ---------- cart ops ----------
  function addToCart(id, qty = 1, silent) {
    id = Number(id); qty = Math.max(1, Math.floor(qty));
    const it = cart.find((x) => x.id === id);
    if (it) it.qty = Math.min(999, it.qty + qty); else cart.push({ id, qty });
    saveCart();
    if (!silent) { toast('تمت الإضافة إلى السلة ✓'); refreshCart(); }
  }
  function setQty(id, qty) {
    id = Number(id);
    if (qty <= 0) cart = cart.filter((x) => x.id !== id);
    else { const it = cart.find((x) => x.id === id); if (it) it.qty = Math.min(999, qty); }
    saveCart(); refreshCart();
  }

  let lastQuote = null;
  async function refreshCart() {
    const targets = $$('[data-cart-lines]');
    const co = $('#checkoutForm');
    if (!targets.length && !co) return;
    if (!cart.length) { lastQuote = null; renderCart(null); if (co) renderCheckout(null); return; }
    try {
      const q = await api('/api/quote', { items: cart, coupon: co ? co.coupon.value.trim() : '', zone: co ? co.zone.value : '' });
      // drop products that no longer exist, clamp quantities to stock
      if (q.removed.length) { cart = cart.filter((x) => !q.removed.includes(x.id)); saveCart(); toast('تمت إزالة منتج لم يعد متاحاً من السلة', true); }
      lastQuote = q; renderCart(q); if (co) renderCheckout(q);
    } catch (e) { targets.forEach((t) => { t.innerHTML = `<div class="empty-box sm"><p>${esc(e.message)}</p><button class="btn ghost sm" type="button" data-retry-cart>إعادة المحاولة</button></div>`; }); }
  }
  const thumb = (l) => (l.image_id ? `<img src="/media/${l.image_id}?w=160" alt="" loading="lazy">` : esc(l.icon || '📱'));
  function renderCart(q) {
    $$('[data-cart-lines]').forEach((t) => {
      if (!q || !q.lines.length) { t.innerHTML = '<div class="empty-box sm"><span>🛒</span><p>السلة فارغة حالياً</p><a class="btn primary sm" href="/shop">تصفّح المنتجات</a></div>'; return; }
      t.innerHTML = q.lines.map((l) => `<div class="line" data-line="${l.id}">
        <a class="line-img" href="/product/${esc(l.slug)}">${thumb(l)}</a>
        <div>
          <a class="line-name" href="/product/${esc(l.slug)}">${esc(l.name)}</a>
          <div class="line-meta">${money(l.unit_price)} للقطعة${l.price_type === 'wholesale' ? '<span class="ws">سعر الجملة</span>' : (l.wholesale_price ? ` · جملة ${money(l.wholesale_price)} من ${l.wholesale_min_qty} قطع` : '')}</div>
          ${l.error ? `<div class="line-err">${esc(l.error)}</div>` : ''}
          <div class="line-ctl">
            <div class="qty"><button type="button" data-line-step="1" aria-label="زيادة">+</button><input type="number" value="${l.qty}" min="1" max="${l.stock}" inputmode="numeric" aria-label="الكمية" data-line-qty><button type="button" data-line-step="-1" aria-label="إنقاص">−</button></div>
            <b class="line-total">${money(l.line_total)}</b>
          </div>
          <button class="rm" type="button" data-line-rm>حذف</button>
        </div></div>`).join('');
    });
    $$('[data-cart-subtotal]').forEach((el) => { el.textContent = money(q ? q.subtotal : 0); });
    $$('[data-cart-savings]').forEach((el) => { const s = q && q.wholesale_savings; el.hidden = !s; if (s) el.textContent = `وفّرت ${money(s)} بأسعار الجملة 🎉`; });
    const hasErr = q && q.errors.length;
    $$('[data-checkout-link]').forEach((a) => a.classList.toggle('disabled', !q || !q.lines.length));
    void hasErr;
  }
  document.addEventListener('click', (e) => {
    const line = e.target.closest('[data-line]'); if (!line) return;
    const id = Number(line.dataset.line); const it = cart.find((x) => x.id === id); if (!it) return;
    const step = e.target.closest('[data-line-step]');
    if (step) {
      const l = lastQuote && lastQuote.lines.find((x) => x.id === id);
      const next = it.qty + Number(step.dataset.lineStep);
      if (l && next > l.stock && Number(step.dataset.lineStep) > 0) return toast(`المتوفر ${l.stock} فقط`, true);
      setQty(id, next);
    }
    if (e.target.closest('[data-line-rm]')) setQty(id, 0);
  });
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-line-qty]'); if (!inp) return;
    const id = Number(inp.closest('[data-line]').dataset.line);
    setQty(id, Math.max(0, Math.floor(Number(inp.value) || 0)));
  });

  // ---------- drawer ----------
  const drawer = $('#cartDrawer'); const overlay = $('.overlay');
  function openCart() {
    if (document.body.classList.contains('is-checkout')) return;
    drawer.classList.add('open'); overlay.classList.add('show'); drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('lock'); refreshCart();
  }
  function closeCart() { drawer.classList.remove('open'); overlay.classList.remove('show'); drawer.setAttribute('aria-hidden', 'true'); document.body.classList.remove('lock'); }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-cart]')) { e.preventDefault(); openCart(); }
    if (e.target.closest('[data-close-cart]')) closeCart();
    if (e.target.closest('[data-retry-cart]')) refreshCart();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) closeCart(); });

  // ---------- product buttons ----------
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add && !add.disabled) {
      addToCart(add.dataset.add, 1);
      add.classList.add('added'); setTimeout(() => add.classList.remove('added'), 900);
    }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const id = Number(fav.dataset.fav);
      const on = favs.includes(id);
      favs = on ? favs.filter((x) => x !== id) : [id, ...favs];
      saveFavs(); toast(on ? 'تمت الإزالة من المفضلة' : 'تمت الإضافة إلى المفضلة ♥');
      const page = $('[data-favorites]'); if (page && on) fav.closest('.card')?.remove();
    }
    const addQty = e.target.closest('[data-add-qty]');
    if (addQty && !addQty.disabled) {
      const qty = Number($('[data-qty]')?.value) || 1;
      addToCart(addQty.dataset.addQty, qty, true); toast('تمت الإضافة إلى السلة ✓'); openCart();
    }
    const buyNow = e.target.closest('[data-buy-now]');
    if (buyNow) { addToCart(buyNow.dataset.buyNow, Number($('[data-qty]')?.value) || 1, true); location.href = '/checkout'; }
    const wa = e.target.closest('[data-wa-text],[data-wa-product]');
    if (wa) {
      e.preventDefault();
      let text = wa.dataset.waText;
      if (!text) {
        const qty = wa.hasAttribute('data-wa-ask') || wa.closest('.pdp') ? Math.max(1, Number($('[data-qty]')?.value) || 1) : 1;
        text = [`السلام عليكم، أبي أطلب / أعرف سعر وتوفر المنتج:`, `${wa.dataset.waProduct}`, `رقم المنتج: ${wa.dataset.waSku}`, `الكمية: ${qty}`, location.origin + wa.dataset.waUrl].join('\n');
      }
      openWhatsApp(text);
    }
    if (e.target.closest('[data-wa-close]') || e.target.matches('[data-wa-pick]')) $('[data-wa-pick]').hidden = true;
    const num = e.target.closest('[data-wa-num]');
    if (num) { $('[data-wa-pick]').hidden = true; window.open(`https://wa.me/${num.dataset.waNum}?text=${encodeURIComponent(pendingWa)}`, '_blank', 'noopener'); }
    if (e.target.closest('[data-theme-toggle]')) {
      const dark = !isDark();
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      try { localStorage.setItem('ka_theme', dark ? 'dark' : 'light'); } catch {}
      toast(dark ? 'تم تفعيل الوضع الليلي 🌙' : 'تم تفعيل الوضع النهاري ☀️');
    }
  });
  const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  // WhatsApp: one number opens directly, two numbers let the customer choose
  let pendingWa = '';
  function openWhatsApp(text) {
    const nums = (document.body.dataset.whatsapp || '').split(',').filter(Boolean);
    if (!nums.length) { location.href = '/page/contact'; return; }
    if (nums.length === 1) { window.open(`https://wa.me/${nums[0]}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); return; }
    pendingWa = text; const pick = $('[data-wa-pick]'); pick.hidden = false; pick.querySelector('[data-wa-num]').focus();
  }
  document.addEventListener('keydown', (e) => { const pick = $('[data-wa-pick]'); if (e.key === 'Escape' && pick && !pick.hidden) pick.hidden = true; });

  // quantity stepper for "price on request" products (sent in the WhatsApp message)
  const ask = $('[data-ask]');
  if (ask) {
    const inp = $('[data-qty]', ask);
    const fix = () => { inp.value = Math.min(999, Math.max(1, Math.floor(Number(inp.value) || 1))); };
    ask.addEventListener('click', (e) => { const s = e.target.closest('[data-step]'); if (s) { inp.value = Number(inp.value) + Number(s.dataset.step); fix(); } });
    inp.addEventListener('change', fix);
  }
  // quantity stepper on product page (+ live wholesale note)
  const buy = $('.buy:not([data-ask])');
  if (buy) {
    const inp = $('[data-qty]', buy); const max = Math.max(1, Number(buy.dataset.max) || 1);
    const ws = Number(buy.dataset.ws); const wsMin = Number(buy.dataset.wsMin); const retail = Number(buy.dataset.retail);
    const note = $('[data-unit-note]');
    const update = () => {
      let v = Math.floor(Number(inp.value) || 1); v = Math.min(Math.max(1, v), max); inp.value = v;
      if (note) {
        if (ws && v >= wsMin) { note.hidden = false; note.textContent = `✓ سعر الجملة مطبّق: ${money(ws)} للقطعة — الإجمالي ${money(ws * v)} (وفّرت ${money((retail - ws) * v)})`; }
        else if (ws) { note.hidden = false; note.textContent = `أضف ${wsMin - v} قطعة أخرى للحصول على سعر الجملة ${money(ws)}`; }
        else note.hidden = true;
      }
    };
    buy.addEventListener('click', (e) => { const s = e.target.closest('[data-step]'); if (s) { inp.value = Number(inp.value) + Number(s.dataset.step); update(); } });
    inp.addEventListener('change', update); update();
  }

  // gallery
  $$('[data-g-thumb]').forEach((b) => b.addEventListener('click', () => {
    const main = $('[data-g-main]'); if (main) main.src = b.dataset.gThumb;
    $$('[data-g-thumb]').forEach((x) => x.classList.toggle('on', x === b));
  }));

  // filters: open on wide screens, collapsed on phones so products show first
  $$('[data-filters]').forEach((d) => { if (matchMedia('(min-width: 980px)').matches) d.open = true; });

  // sort select
  $$('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

  // ---------- hero slider (RTL-aware) ----------
  const slider = $('[data-slider]');
  if (slider) {
    const slides = $$('.slide', slider); const dots = $$('[data-dot]');
    let i = 0; let timer;
    const go = (n) => { i = (n + slides.length) % slides.length; slider.scrollTo({ left: -i * slider.clientWidth * (getComputedStyle(slider).direction === 'rtl' ? 1 : -1) }); mark(); };
    const mark = () => dots.forEach((d, k) => d.classList.toggle('on', k === i));
    slider.addEventListener('scroll', () => { const n = Math.round(Math.abs(slider.scrollLeft) / slider.clientWidth); if (n !== i) { i = n; mark(); } }, { passive: true });
    dots.forEach((d) => d.addEventListener('click', () => { go(Number(d.dataset.dot)); restart(); }));
    const restart = () => { clearInterval(timer); if (slides.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => go(i + 1), 6000); };
    slider.addEventListener('pointerdown', () => clearInterval(timer));
    mark(); restart();
  }

  // ---------- search suggestions ----------
  $$('[data-suggest]').forEach((input) => {
    const box = input.closest('form').querySelector('.suggest');
    let t; let ctl; let idx = -1;
    const hide = () => { box.hidden = true; idx = -1; };
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 2) return hide();
      t = setTimeout(async () => {
        try {
          ctl?.abort(); ctl = new AbortController();
          const r = await fetch('/api/search/suggest?q=' + encodeURIComponent(q), { signal: ctl.signal }).then((x) => x.json());
          if (!r.items.length) { box.innerHTML = `<a class="s-all" href="/shop?q=${encodeURIComponent(q)}">لا توجد نتائج مطابقة — ابحث في كل المنتجات</a>`; box.hidden = false; return; }
          box.innerHTML = r.items.map((p) => `<a href="/product/${esc(p.slug)}"><span class="s-img">${p.image_id ? `<img src="/media/${p.image_id}?w=160" alt="">` : esc(p.icon || '📱')}</span><span class="s-name">${esc(p.name)}</span><span class="s-price">${p.price > 0 ? money(p.price) : 'السعر عند الطلب'}</span></a>`).join('')
            + `<a class="s-all" href="/shop?q=${encodeURIComponent(q)}">عرض كل النتائج ←</a>`;
          box.hidden = false; idx = -1;
        } catch {}
      }, 180);
    });
    input.addEventListener('keydown', (e) => {
      const links = $$('a', box); if (box.hidden || !links.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links.forEach((l, k) => l.classList.toggle('on', k === idx)); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); location.href = links[idx].href; }
      else if (e.key === 'Escape') hide();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) hide(); });
  });

  // ---------- favorites page ----------
  const favPage = $('[data-favorites]');
  if (favPage) {
    if (!favs.length) favPage.innerHTML = '<div class="empty-box"><span>♡</span><p>لم تُضِف أي منتج إلى المفضلة بعد.</p><a class="btn primary" href="/shop">تصفّح المنتجات</a></div>';
    else fetch('/partials/cards?ids=' + favs.join(',')).then((r) => r.text()).then((h) => { favPage.innerHTML = h; syncFavButtons(); });
  }

  // ---------- checkout ----------
  const co = $('#checkoutForm');
  function renderCheckout(q) {
    const lines = $('[data-co-lines]');
    const submit = $('[data-submit]');
    const set = (k, v) => { const el = $(`[data-co="${k}"]`); if (el) el.textContent = v; };
    if (!q || !q.lines.length) {
      lines.innerHTML = '<tr><td colspan="6"><div class="empty-box sm"><p>السلة فارغة</p><a class="btn primary sm" href="/shop">تصفّح المنتجات</a></div></td></tr>'; set('words', '');
      ['subtotal', 'total'].forEach((k) => set(k, '—')); submit.disabled = true; return;
    }
    submit.disabled = false;
    lines.innerHTML = q.lines.map((l, k) => `<tr data-line="${l.id}"><td class="m">${k + 1}</td>
      <td class="nm"><a href="/product/${esc(l.slug)}">${esc(l.name)}</a>${l.price_type === 'wholesale' ? ' <span class="ws">جملة</span>' : ''}${l.error ? `<br><small style="color:var(--red)">${esc(l.error)}</small>` : ''}</td>
      <td><div class="qty sm"><button type="button" data-line-step="1" aria-label="زيادة">+</button><input type="number" value="${l.qty}" min="1" max="${l.stock}" inputmode="numeric" aria-label="الكمية" data-line-qty><button type="button" data-line-step="-1" aria-label="إنقاص">−</button></div></td>
      <td class="nw">${money(l.unit_price)}</td><td class="nw"><b>${money(l.line_total)}</b></td><td><button class="rm" type="button" data-line-rm aria-label="حذف">✕</button></td></tr>`).join('');
    set('words', q.total_words || '');
    set('subtotal', money(q.subtotal));
    $('[data-co-row="discount"]').hidden = !q.discount; set('discount', '-' + money(q.discount));
    set('shipping', q.zone ? (q.free_shipping ? 'مجاني 🎉' : money(q.shipping)) : 'اختر المنطقة');
    set('total', money(q.total));
    const msg = $('[data-coupon-msg]'); const code = co.coupon.value.trim();
    if (code) { msg.hidden = false; msg.className = 'coupon-msg ' + (q.coupon ? 'ok' : 'err'); msg.textContent = q.coupon ? `✓ تم تطبيق كود الخصم ${q.coupon.code}` : q.coupon_error; }
    else msg.hidden = true;
  }
  if (co) {
    const saved = store.get('ka_customer', {});
    for (const k of ['name', 'phone', 'address', 'zone']) if (saved[k] != null && co[k] && !co[k].value) co[k].value = saved[k];
    if (co.zone.value) refreshCart();
    co.zone.addEventListener('change', refreshCart);
    $('[data-apply-coupon]').addEventListener('click', refreshCart);
    co.coupon.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); refreshCart(); } });
    const err = $('[data-form-error]');
    const showErr = (m) => { err.hidden = !m; err.textContent = m || ''; if (m) err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    co.addEventListener('input', (e) => { e.target.classList.remove('invalid'); if (!err.hidden && e.target.name !== 'coupon') showErr(''); });
    co.addEventListener('submit', async (e) => {
      e.preventDefault(); showErr('');
      const f = co.elements;
      const phoneDigits = f.phone ? f.phone.value.replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '') : '000000000';
      const checks = [
        [f.name, !f.name || f.name.value.trim().length >= 2, 'يرجى إدخال الاسم الكامل'],
        [f.phone, phoneDigits.length >= 9, 'يرجى إدخال رقم هاتف صحيح'],
        [f.zone, f.zone.value !== '', 'يرجى اختيار منطقة التوصيل'],
        [f.address, !f.address || f.address.value.trim().length >= 3, 'يرجى إدخال العنوان بالتفصيل'],
      ];
      for (const [el, ok, m] of checks) if (!ok) { el.classList.add('invalid'); el.focus(); return showErr(m); }
      if (!cart.length) return showErr('السلة فارغة');
      const btn = $('[data-submit]'); const label = btn.innerHTML; btn.disabled = true; btn.textContent = 'جارِ حفظ الفاتورة...';
      const body = { name: f.name ? f.name.value : '', phone: f.phone ? f.phone.value : '', zone: Number(f.zone.value), address: f.address ? f.address.value : '', notes: f.notes.value, payment_method: (co.querySelector('[name=payment_method]:checked') || {}).value, coupon: f.coupon.value.trim(), website: f.website.value, items: cart };
      try {
        const r = await api('/api/orders', body);
        if (f.address) store.set('ka_customer', { name: body.name, phone: body.phone, address: body.address, zone: f.zone.value });
        cart = []; saveCart();
        location.href = r.url;
      } catch (ex) {
        btn.disabled = false; btn.innerHTML = label;
        if (ex.data && ex.data.login) { location.href = '/account/login?next=/checkout'; return; }
        if (ex.data && ex.data.quote) { lastQuote = ex.data.quote; renderCheckout(ex.data.quote); }
        if (ex.data && ex.data.fields) { const k = Object.keys(ex.data.fields)[0]; if (f[k]) f[k].classList.add('invalid'); }
        showErr(ex.message);
      }
    });
  }

  // ---------- after buying: open WhatsApp with the invoice ----------
  const auto = $('[data-wa-auto]');
  if (auto) {
    try { history.replaceState(null, '', location.pathname + location.search.replace(/[?&]send=1/, '').replace(/^&/, '?')); } catch {}
    const nums = (document.body.dataset.whatsapp || '').split(',').filter(Boolean);
    auto.classList.add('pulse'); auto.scrollIntoView({ block: 'center' });
    void nums;
  }

  // ---------- customer account ----------
  const af = $('#authForm');
  if (af) af.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-form-error]', af); const f = af.elements; const reg = af.dataset.mode === 'register';
    const fail = (el, m) => { if (el) { el.classList.add('invalid'); el.focus(); } err.hidden = false; err.textContent = m; };
    err.hidden = true;
    if (reg && f.name.value.trim().length < 2) return fail(f.name, 'اكتب اسمك الكامل');
    if (f.phone.value.replace(/[^0-9٠-٩]/g, '').length < 9) return fail(f.phone, 'اكتب رقم هاتف صحيح');
    if (f.password.value.length < (reg ? 6 : 1)) return fail(f.password, reg ? 'كلمة المرور لازم تكون 6 أحرف أو أرقام على الأقل' : 'اكتب كلمة المرور');
    if (reg && f.password.value !== f.password2.value) return fail(f.password2, 'كلمتا المرور غير متطابقتين');
    const btn = af.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await api('/api/account/' + (reg ? 'register' : 'login'), reg ? { name: f.name.value, phone: f.phone.value, password: f.password.value } : { phone: f.phone.value, password: f.password.value });
      location.href = af.dataset.next || '/account';
    } catch (ex) { btn.disabled = false; const k = ex.data && ex.data.fields && Object.keys(ex.data.fields)[0]; fail(k && f[k], ex.message); }
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    try { await api('/api/account/logout', {}); } catch {}
    location.href = '/';
  });
  for (const [id, url, okMsg] of [['#profileForm', '/api/account/profile', 'تم حفظ بياناتك ✓'], ['#passForm', '/api/account/password', 'تم تغيير كلمة المرور ✓']]) {
    const pf = $(id); if (!pf) continue;
    pf.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = $('[data-form-error]', pf); err.hidden = true;
      const data = {}; for (const el of pf.elements) if (el.name) data[el.name] = el.value;
      try { await api(url, data); toast(okMsg); if (id === '#passForm') pf.reset(); } catch (ex) { err.hidden = false; err.textContent = ex.message; }
    });
  }

  // ---------- contact form ----------
  const cf = $('#contactForm');
  if (cf) cf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-form-error]', cf); err.hidden = true;
    const f = cf.elements;
    if (f.name.value.trim().length < 2) { f.name.classList.add('invalid'); err.hidden = false; err.textContent = 'يرجى إدخال الاسم'; return; }
    if (f.body.value.trim().length < 3) { f.body.classList.add('invalid'); err.hidden = false; err.textContent = 'يرجى كتابة الرسالة'; return; }
    const btn = cf.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await api('/api/contact', { name: f.name.value, phone: f.phone.value, subject: f.subject.value, body: f.body.value, website: f.website.value });
      cf.innerHTML = '<div class="empty-box sm"><span>✅</span><p>تم إرسال رسالتك بنجاح، سنتواصل معك قريباً.</p></div>';
    } catch (ex) { btn.disabled = false; err.hidden = false; err.textContent = ex.message; }
  });

  // keep the list position when coming back from a product, and always open a product at the top
  try {
    history.scrollRestoration = 'manual';
    const key = 'ka_scroll:' + location.pathname + location.search;
    const nav = performance.getEntriesByType('navigation')[0];
    if ($('.pdp') || !nav || nav.type !== 'back_forward') { if (!location.hash) window.scrollTo(0, 0); }
    else { const y = Number(sessionStorage.getItem(key)); if (y) { const go = () => window.scrollTo(0, y); go(); requestAnimationFrame(go); setTimeout(go, 120); } }
    addEventListener('pagehide', () => sessionStorage.setItem(key, String(Math.round(scrollY))));
    addEventListener('pageshow', (e) => { if (e.persisted) { const y = Number(sessionStorage.getItem(key)); if (y && !$('.pdp')) window.scrollTo(0, y); } });
  } catch {}

  syncCounts(); syncFavButtons();
  if ($('[data-cart-lines][data-full]') || co) refreshCart();
  window.addEventListener('storage', (e) => { if (e.key === 'ka_cart') { cart = store.get('ka_cart', []); syncCounts(); } if (e.key === 'ka_favs') { favs = store.get('ka_favs', []); syncCounts(); syncFavButtons(); } });
})();
