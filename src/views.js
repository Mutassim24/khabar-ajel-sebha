'use strict';
// Server-rendered storefront views (Arabic, RTL). All interpolations are escaped by html``.
const { html, raw, esc, money } = require('./util');
const { getSettings } = require('./db');

const ASSET_V = process.env.ASSET_VERSION || String(Date.now()).slice(-8);
const asset = (p) => `${p}?v=${ASSET_V}`;
const img = (id, w) => (id ? `/media/${id}${w ? '?w=' + w : ''}` : null);

function siteUrl(req) {
  const s = getSettings();
  if (s.site_url) return String(s.site_url).replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}

// Very small, safe Markdown subset: ## headings, - lists, paragraphs, **bold**.
function md(text) {
  const out = []; let list = null; let para = [];
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = null; } };
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) { flushPara(); flushList(); continue; }
    if (/^#{2,3}\s+/.test(t)) { flushPara(); flushList(); out.push(`<h2>${inline(t.replace(/^#+\s+/, ''))}</h2>`); continue; }
    if (/^[-•*]\s+/.test(t)) { flushPara(); (list ||= []).push(t.replace(/^[-•*]\s+/, '')); continue; }
    flushList(); para.push(t);
  }
  flushPara(); flushList();
  return raw(out.join(''));
}

function brandMark(s, cls = '') {
  if (s.logo_media_id) return html`<img class="brand-logo ${cls}" src="${img(s.logo_media_id)}" alt="${s.store_name}" width="44" height="44">`;
  return html`<span class="brandmark ${cls}" aria-hidden="true">خ<i>⚡</i></span>`;
}

const icons = {
  search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'),
  heart: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6C1.3 8.4 3.2 5 6.6 5c2 0 3.4 1.1 4.4 2.6l1 1.4 1-1.4C14 6.1 15.4 5 17.4 5c3.4 0 5.3 3.4 3.8 6.4C19 15.6 12 20 12 20z"/></svg>'),
  cart: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>'),
  home: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>'),
  grid: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>'),
  truck: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>'),
  wa: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.8z"/><path d="M9 9.5c.3 1.6 1.9 3.6 3.9 4.6l1.3-1.2 2 1-.4 1.6c-3.3.3-7.5-3.6-7.8-6.9l1.6-.5 1 2z"/></svg>'),
  close: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'),
  moon: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'),
  sun: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'),
  filter: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>'),
};

function productCard(p) {
  const a = p.availability;
  return html`<article class="card" data-id="${p.id}">
  <a class="card-media" href="/product/${p.slug}" aria-label="${p.name}">
    ${p.image_id
      ? html`<img src="${img(p.image_id, 480)}" alt="${p.name}" loading="lazy" width="400" height="400">${p.image2_id ? html`<img class="alt" src="${img(p.image2_id, 480)}" alt="" loading="lazy" width="400" height="400">` : ''}`
      : html`<span class="ph" aria-hidden="true">${p.category_icon || '📱'}</span>`}
    <span class="badges">${p.discount_pct ? html`<b class="badge sale">-${p.discount_pct}%</b>` : ''}${p.badge ? html`<b class="badge">${p.badge}</b>` : ''}</span>
    ${a.key === 'out' ? html`<span class="soldout">نفد المخزون</span>` : ''}
  </a>
  <button class="fav" type="button" data-fav="${p.id}" aria-label="أضف إلى المفضلة" aria-pressed="false">${icons.heart}</button>
  <div class="card-body">
    <a class="card-cat" href="/category/${p.category_slug || ''}">${p.parent_name ? p.parent_name + ' · ' : ''}${p.category_name || ''}</a>
    <h3><a href="/product/${p.slug}">${p.name}</a></h3>
    <div class="card-meta">${a.key === 'ask' ? '' : html`<span class="stock ${a.key}">${a.label}</span>`}${p.brand ? html`<span class="brand-tag">${p.brand}</span>` : ''}${p.has_wholesale ? html`<span class="ws" title="سعر الجملة من ${p.wholesale_min_qty} قطع">جملة ${money(p.wholesale_price)}</span>` : ''}</div>
    <div class="card-foot">
      ${a.key === 'ask'
        ? html`<div class="price"><strong class="ask">السعر عند الطلب</strong></div><button class="add ask-btn" type="button" data-wa-product="${p.name}" data-wa-sku="${p.sku}" data-wa-url="/product/${p.slug}" aria-label="اسأل عن السعر عبر واتساب">${icons.wa}<span>اسأل</span></button>`
        : html`<div class="price"><strong>${money(p.price)}</strong>${p.discount_pct ? html`<s>${money(p.compare_at_price)}</s>` : ''}</div>
      <button class="add" type="button" data-add="${p.id}" ${a.key === 'out' ? 'disabled' : ''} aria-label="أضف إلى السلة">${icons.cart}<span>أضف</span></button>`}
    </div>
  </div>
</article>`;
}

function grid(items, empty = 'لا توجد منتجات حالياً.') {
  if (!items.length) return html`<div class="empty-box"><span>🔎</span><p>${empty}</p></div>`;
  return html`<div class="grid">${items.map(productCard)}</div>`;
}

function layout(req, { title, description, body, active = '', canonical, image, jsonld, noindex, bodyClass = '' }) {
  const s = getSettings();
  const base = siteUrl(req);
  const fullTitle = title ? `${title} | ${s.store_name}` : `${s.store_name} | ${s.tagline}`;
  const desc = description || s.seo_description;
  const url = base + (canonical || req.url.split('?')[0]);
  const cats = (req.ctx.categories || []).filter((c) => !c.parent_id);
  const waNums = [s.whatsapp, s.whatsapp2].map((n) => String(n || '').replace(/\D/g, '')).filter(Boolean).map((n) => (n.startsWith('0') ? '218' + n.slice(1) : n));
  const wa = waNums.join(',');
  const waLink = waNums.length ? `https://wa.me/${waNums[0]}` : null;
  const orgLd = { '@context': 'https://schema.org', '@type': 'Store', name: s.store_name, url: base, address: s.address, telephone: s.phone || undefined, currenciesAccepted: 'LYD', priceRange: '$' };
  return '<!doctype html>' + html`<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#0f2240"><meta name="color-scheme" content="light dark">
<meta property="og:type" content="website"><meta property="og:locale" content="ar_LY">
<meta property="og:site_name" content="${s.store_name}"><meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${desc}"><meta property="og:url" content="${url}">
${image ? html`<meta property="og:image" content="${base + image}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap">
<script src="${asset('/js/theme.js')}"></script>
<link rel="stylesheet" href="${asset('/css/store.css')}">
<script type="application/ld+json">${raw(JSON.stringify(orgLd).replace(/</g, '\\u003c'))}</script>
${jsonld ? html`<script type="application/ld+json">${raw(JSON.stringify(jsonld).replace(/</g, '\\u003c'))}</script>` : ''}
<script src="${asset('/js/store.js')}" defer></script>
</head>
<body class="${bodyClass}" data-whatsapp="${wa}">
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
${s.topline ? html`<div class="topline">${s.topline}</div>` : ''}
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/" aria-label="${s.store_name} — الرئيسية">${brandMark(s)}<span><b>${s.store_name}</b><small>${s.tagline}</small></span></a>
    <form class="search" action="/shop" method="get" role="search" autocomplete="off">
      <input type="search" name="q" value="${req.query.q || ''}" placeholder="ابحث: شاحن سامسونج، جراب ايفون 15، سماعة..." aria-label="بحث المنتجات" data-suggest>
      <button type="submit" aria-label="بحث">${icons.search}</button>
      <div class="suggest" hidden></div>
    </form>
    <nav class="actions" aria-label="روابط سريعة">
      <button class="act" type="button" data-theme-toggle aria-label="الوضع الليلي" title="الوضع الليلي / النهاري"><span class="i-moon">${icons.moon}</span><span class="i-sun">${icons.sun}</span></button>
      <a class="act hide-sm" href="/track">${icons.truck}<span>تتبع طلبك</span></a>
      <a class="act" href="/favorites" aria-label="المفضلة">${icons.heart}<span class="hide-sm">المفضلة</span><i class="count" data-fav-count hidden>0</i></a>
      <button class="act" type="button" data-open-cart aria-label="السلة">${icons.cart}<span class="hide-sm">السلة</span><i class="count" data-cart-count hidden>0</i></button>
    </nav>
  </div>
  <nav class="catnav" aria-label="الأقسام"><div class="wrap">
    <a href="/" class="${active === 'home' ? 'on' : ''}">الرئيسية</a>
    <a href="/shop" class="${active === 'shop' ? 'on' : ''}">كل المنتجات</a>
    <a href="/shop?sale=1" class="hot ${active === 'sale' ? 'on' : ''}">🔥 العروض</a>
    ${cats.map((c) => html`<a href="/category/${c.slug}" class="${active === 'cat:' + c.slug ? 'on' : ''}">${c.name}</a>`)}
  </div></nav>
</header>
${s.announcement ? html`<div class="announce wrap">${s.announcement}</div>` : ''}
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="wrap foot-grid">
    <div class="foot-brand">
      <a class="brand light" href="/">${brandMark(s)}<span><b>${s.store_name}</b><small>${s.tagline}</small></span></a>
      <p>${s.address}${s.working_hours ? ' · ' + s.working_hours : ''}</p>
      <div class="social">
        ${waLink ? html`<a href="${waLink}" target="_blank" rel="noopener">واتساب</a>` : ''}
        ${s.facebook ? html`<a href="${s.facebook}" target="_blank" rel="noopener">فيسبوك</a>` : ''}
        ${s.instagram ? html`<a href="${s.instagram}" target="_blank" rel="noopener">إنستغرام</a>` : ''}
        ${s.tiktok ? html`<a href="${s.tiktok}" target="_blank" rel="noopener">تيك توك</a>` : ''}
      </div>
    </div>
    <div><b>تسوّق</b><a href="/shop">كل المنتجات</a><a href="/shop?sale=1">العروض والخصومات</a><a href="/shop?sort=bestsellers">الأكثر مبيعاً</a><a href="/shop?wholesale=1">منتجات الجملة</a></div>
    <div><b>الأقسام</b>${cats.slice(0, 6).map((c) => html`<a href="/category/${c.slug}">${c.name}</a>`)}</div>
    <div><b>خدمة العملاء</b><a href="/page/about">من نحن</a><a href="/page/shipping">الشحن والاستبدال</a><a href="/page/privacy">سياسة الخصوصية</a><a href="/page/contact">اتصل بنا</a><a href="/track">تتبع طلبك</a></div>
  </div>
  <div class="wrap copyright">© ${new Date().getFullYear()} ${s.store_name} · جميع الحقوق محفوظة · الأسعار بالدينار الليبي</div>
</footer>
<nav class="bottom-nav" aria-label="تنقل الجوال">
  <a href="/" class="${active === 'home' ? 'on' : ''}">${icons.home}<span>الرئيسية</span></a>
  <a href="/categories" class="${active === 'cats' ? 'on' : ''}">${icons.grid}<span>الأقسام</span></a>
  <a href="/favorites" class="${active === 'favs' ? 'on' : ''}">${icons.heart}<span>المفضلة</span><i class="count" data-fav-count hidden>0</i></a>
  <button type="button" data-open-cart>${icons.cart}<span>السلة</span><i class="count" data-cart-count hidden>0</i></button>
  <a href="/track" class="${active === 'track' ? 'on' : ''}">${icons.truck}<span>طلبي</span></a>
</nav>
${waLink ? html`<a class="wa-float" href="${waLink}" target="_blank" rel="noopener" data-wa-text="السلام عليكم، عندي استفسار من موقع ${s.store_name}" aria-label="تواصل عبر واتساب">${icons.wa}</a>` : ''}
<div class="wa-pick" data-wa-pick hidden role="dialog" aria-label="اختر رقم واتساب"><div class="wa-pick-box"><b>تواصل معنا عبر واتساب</b><p>اختر الرقم اللي تبي تراسله:</p>${waNums.map((n, i) => html`<button type="button" class="btn wa block" data-wa-num="${n}">${icons.wa} ${i ? 'الرقم الثاني' : 'الرقم الأول'} <span dir="ltr">+${n}</span></button>`)}<button type="button" class="btn ghost block" data-wa-close>إلغاء</button></div></div>
<aside class="drawer" id="cartDrawer" aria-hidden="true" aria-label="سلة المشتريات">
  <div class="drawer-head"><h2>سلة المشتريات</h2><button type="button" data-close-cart aria-label="إغلاق">${icons.close}</button></div>
  <div class="drawer-body" data-cart-lines><div class="empty-box sm"><p>جارِ التحميل...</p></div></div>
  <div class="drawer-foot">
    <div class="row"><span>المجموع</span><b data-cart-subtotal>0 د.ل</b></div>
    <p class="hint" data-cart-savings hidden></p>
    <a class="btn primary block" href="/checkout">إتمام الطلب</a>
    <a class="btn ghost block" href="/cart">عرض السلة</a>
  </div>
</aside>
<div class="overlay" data-close-cart></div>
<div class="toast" role="status" aria-live="polite"></div>
</body></html>`.s;
}

// ---------- pages ----------
function bannerSlides(banners) {
  if (!banners.length) return '';
  return html`<section class="hero" aria-label="العروض">
  <div class="slides" data-slider>
    ${banners.map((b, i) => html`<div class="slide theme-${b.theme} ${b.media_id ? 'has-img' : ''}" ${i ? '' : raw('data-active')}>
      ${b.media_id ? html`<img class="slide-bg" src="${img(b.media_id)}" alt="" ${i ? raw('loading="lazy"') : raw('fetchpriority="high"')}>` : ''}
      <div class="slide-copy">
        <span class="eyebrow">${i === 0 ? 'متجرك الموثوق في سبها' : 'عرض خاص'}</span>
        <h2 class="slide-title">${b.title}</h2>
        ${b.subtitle ? html`<p>${b.subtitle}</p>` : ''}
        ${b.cta_text && b.link ? html`<a class="btn primary" href="${b.link}">${b.cta_text} <span aria-hidden="true">←</span></a>` : ''}
      </div>
      ${b.media_id ? '' : html`<div class="slide-art" aria-hidden="true"><span class="orb"></span><span class="phone">⚡<small>FAST<br>CHARGE</small></span><span class="fl f1">🔋</span><span class="fl f2">🎧</span><span class="fl f3">📱</span></div>`}
    </div>`)}
  </div>
  ${banners.length > 1 ? html`<div class="dots">${banners.map((_, i) => html`<button type="button" data-dot="${i}" aria-label="شريحة ${i + 1}"></button>`)}</div>` : ''}
</section>`;
}

function section(title, eyebrow, link, items, linkText = 'عرض الكل') {
  if (!items.length) return '';
  return html`<section class="block">
  <div class="block-head"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div>${link ? html`<a class="more" href="${link}">${linkText} ←</a>` : ''}</div>
  ${grid(items)}
</section>`;
}

function categoryTiles(cats) {
  return html`<div class="cat-grid">${cats.filter((c) => !c.parent_id).map((c) => html`<a class="cat ${c.cover_id ? 'has-img' : ''}" href="/category/${c.slug}">${c.cover_id ? html`<span class="cat-img"><img src="${img(c.cover_id, 480)}" alt="" loading="lazy" width="240" height="240"></span>` : html`<span class="cat-ico">${c.icon || '📦'}</span>`}<b>${c.name}</b><small>${c.product_count ? c.product_count + ' منتج' : c.description || ''}</small></a>`)}</div>`;
}

function home(req, d) {
  const s = getSettings();
  const body = html`<div class="wrap">
${bannerSlides(d.banners)}
<section class="perks">
  <div><span>🚚</span><p><b>توصيل لكل ليبيا</b><small>داخل سبها خلال 24 ساعة</small></p></div>
  <div><span>💵</span><p><b>الدفع عند الاستلام</b><small>ومحافظ إلكترونية وتحويل</small></p></div>
  <div><span>🏷️</span><p><b>جملة وقطاعي</b><small>سعر الجملة يُطبَّق تلقائياً</small></p></div>
  <div><span>🔁</span><p><b>استبدال مضمون</b><small>للعيوب المصنعية</small></p></div>
</section>
<section class="block">
  <div class="block-head"><div><span class="eyebrow">تسوّق حسب احتياجك</span><h2>الأقسام الرئيسية</h2></div><a class="more" href="/categories">كل الأقسام ←</a></div>
  ${categoryTiles(d.categories)}
</section>
${section('عروض وخصومات', 'لفترة محدودة', '/shop?sale=1', d.sale)}
${section('منتجات مميزة', 'اختيارات المتجر', '/shop?featured=1', d.featured)}
${section('الأكثر مبيعاً', 'يفضّلها زبائننا', '/shop?sort=bestsellers', d.best)}
${section('وصل حديثاً', 'جديد المتجر', '/shop?sort=newest', d.newest)}
${!d.featured.length && !d.newest.length ? html`<div class="empty-box"><span>🛍️</span><p>نجهّز المنتجات حالياً — تابعنا قريباً، أو تواصل معنا عبر واتساب لطلب أي منتج.</p></div>` : ''}
<section class="wholesale">
  <div><span class="eyebrow">لأصحاب المحلات والفنيين</span><h2>تبحث عن أسعار الجملة؟</h2><p>${s.wholesale_note}</p></div>
  <div class="ws-actions"><a class="btn primary" href="/shop?wholesale=1">تصفّح منتجات الجملة</a>${s.whatsapp ? html`<button class="btn light" type="button" data-wa-text="السلام عليكم، أرغب بالاستفسار عن أسعار الجملة">استفسر عبر واتساب</button>` : ''}</div>
</section>
</div>`;
  return layout(req, { body, active: 'home' });
}

function qs(base, params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, v);
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

function shop(req, d) {
  const f = d.filters;
  const base = d.category ? `/category/${d.category.slug}` : '/shop';
  const keep = { q: f.q, min: f.min, max: f.max, stock: f.inStock ? 1 : '', sale: f.sale ? 1 : '', featured: f.featured ? 1 : '', wholesale: f.wholesale ? 1 : '', sort: f.sort };
  const heading = d.category ? (d.parent ? `${d.parent.name} — ${d.category.name}` : d.category.name) : f.q ? `نتائج البحث عن «${f.q}»` : f.sale ? 'العروض والخصومات' : f.wholesale ? 'منتجات بأسعار الجملة' : f.featured ? 'منتجات مميزة' : 'كل المنتجات';
  const body = html`<div class="wrap">
<nav class="crumbs" aria-label="مسار التنقل"><a href="/">الرئيسية</a><span>/</span>${d.category ? html`${d.parent ? html`<a href="/category/${d.parent.slug}">${d.parent.name}</a><span>/</span>` : html`<a href="/shop">المنتجات</a><span>/</span>`}<b>${d.category.name}</b>` : html`<b>${heading}</b>`}</nav>
<div class="shop">
  <aside class="filters">
    <details class="filter-box" data-filters>
      <summary>${icons.filter} تصفية النتائج</summary>
      <form method="get" action="${base}" class="filter-form">
        ${f.q ? html`<input type="hidden" name="q" value="${f.q}">` : ''}
        ${f.sort ? html`<input type="hidden" name="sort" value="${f.sort}">` : ''}
        <fieldset><legend>القسم</legend>
          <div class="cat-links">
            <a href="${qs('/shop', { ...keep })}" class="${!d.category ? 'on' : ''}">الكل</a>
            ${d.categories.filter((c) => !c.parent_id).map((c) => html`<a href="${qs('/category/' + c.slug, keep)}" class="${d.category && (d.category.id === c.id || d.category.parent_id === c.id) ? 'on' : ''}">${c.icon} ${c.name} <small>${c.product_count}</small></a>`)}
          </div>
        </fieldset>
        <fieldset><legend>السعر (د.ل)</legend>
          <div class="price-range"><input type="number" name="min" min="0" step="1" inputmode="numeric" placeholder="من" value="${f.min ?? ''}" aria-label="أقل سعر"><span>—</span><input type="number" name="max" min="0" step="1" inputmode="numeric" placeholder="إلى" value="${f.max ?? ''}" aria-label="أعلى سعر"></div>
        </fieldset>
        <fieldset><legend>التوفر والعروض</legend>
          <label class="check"><input type="checkbox" name="stock" value="1" ${f.inStock ? 'checked' : ''}> المتوفر فقط</label>
          <label class="check"><input type="checkbox" name="sale" value="1" ${f.sale ? 'checked' : ''}> عليها خصم</label>
          <label class="check"><input type="checkbox" name="wholesale" value="1" ${f.wholesale ? 'checked' : ''}> متاح بسعر الجملة</label>
          <label class="check"><input type="checkbox" name="featured" value="1" ${f.featured ? 'checked' : ''}> المنتجات المميزة</label>
        </fieldset>
        <div class="filter-actions"><button class="btn primary" type="submit">تطبيق</button><a class="btn ghost" href="${base}">مسح</a></div>
      </form>
    </details>
  </aside>
  <section class="results">
    <div class="results-head">
      <div><h1>${heading}</h1><p class="muted">${d.result.total} منتج</p></div>
      <form method="get" action="${base}" class="sort-form">
        ${Object.entries(keep).filter(([k, v]) => k !== 'sort' && v).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
        <label>ترتيب حسب
          <select name="sort" data-autosubmit>
            ${[['', f.q ? 'الأكثر صلة' : 'المقترح'], ['newest', 'الأحدث'], ['bestsellers', 'الأكثر مبيعاً'], ['price-asc', 'السعر: الأقل أولاً'], ['price-desc', 'السعر: الأعلى أولاً'], ['name', 'الاسم']]
              .map(([v, l]) => html`<option value="${v}" ${(f.sort || '') === v ? 'selected' : ''}>${l}</option>`)}
          </select>
        </label>
        <noscript><button class="btn ghost sm" type="submit">ترتيب</button></noscript>
      </form>
    </div>
    ${d.subs && d.subs.length ? html`<nav class="subcats" aria-label="أنواع ${d.parent ? d.parent.name : d.category.name}">
      <a href="${qs('/category/' + (d.parent || d.category).slug, keep)}" class="${!d.parent ? 'on' : ''}">الكل <small>${(d.parent || d.category).product_count}</small></a>
      ${d.subs.map((c) => html`<a href="${qs('/category/' + c.slug, keep)}" class="${d.category.id === c.id ? 'on' : ''}">${c.cover_id ? html`<img src="${img(c.cover_id, 160)}" alt="" loading="lazy" width="28" height="28">` : ''}${c.name} <small>${c.product_count}</small></a>`)}
    </nav>` : ''}
    ${d.category && d.category.name === 'وصلة (خيط شحن)' ? html`<nav class="subcats plugs" aria-label="نوع المدخل"><span>نوع المدخل:</span>
      ${[['', 'الكل'], ['تايب سي', 'Type-C'], ['ايفون', 'ايفون (لايتننق)'], ['مايكرو', 'مايكرو (عادي)']].map(([q, l]) => html`<a href="${qs('/category/' + d.category.slug, { ...keep, q })}" class="${(f.q || '') === q ? 'on' : ''}">${l}</a>`)}
    </nav>` : ''}
    ${d.category && d.category.description ? html`<p class="cat-desc">${d.category.description}</p>` : ''}
    ${grid(d.result.items, f.q ? 'لم نجد منتجات مطابقة. جرّب كلمات أخرى مثل: شاحن، كابل، جراب، سماعة.' : 'لا توجد منتجات مطابقة لهذه التصفية.')}
    ${d.result.pages > 1 ? html`<nav class="pager" aria-label="الصفحات">
      ${Array.from({ length: d.result.pages }, (_, i) => i + 1).map((n) => html`<a href="${qs(base, { ...keep, page: n > 1 ? n : '' })}" class="${n === d.result.page ? 'on' : ''}" ${n === d.result.page ? raw('aria-current="page"') : ''}>${n}</a>`)}
    </nav>` : ''}
  </section>
</div></div>`;
  const active = d.category ? 'cat:' + (d.parent || d.category).slug : f.sale ? 'sale' : 'shop';
  return layout(req, {
    title: heading, body, active, noindex: !!f.q || d.result.page > 1 && false,
    canonical: d.category ? `/category/${d.category.slug}` : '/shop',
    description: d.category ? `${d.category.name} — ${d.category.description || ''} | تسوّق أونلاين من ${getSettings().store_name} بأفضل الأسعار في ليبيا.` : undefined,
  });
}

function categoriesPage(req, cats) {
  const body = html`<div class="wrap"><nav class="crumbs"><a href="/">الرئيسية</a><span>/</span><b>الأقسام</b></nav>
  <h1 class="page-title">جميع الأقسام</h1>${categoryTiles(cats)}</div>`;
  return layout(req, { title: 'الأقسام', body, active: 'cats' });
}

function productPage(req, p, related) {
  const s = getSettings();
  const a = p.availability;
  const base = siteUrl(req);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.sku, description: p.short_description || p.name,
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined, category: p.category_name || undefined,
    image: p.images.length ? p.images.map((id) => base + img(id)) : undefined,
    offers: !(p.price > 0) ? undefined : { '@type': 'Offer', priceCurrency: 'LYD', price: p.price, url: `${base}/product/${p.slug}`, availability: a.key === 'out' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' },
  };
  const body = html`<div class="wrap">
<nav class="crumbs" aria-label="مسار التنقل"><a href="/">الرئيسية</a><span>/</span>${p.parent_slug ? html`<a href="/category/${p.parent_slug}">${p.parent_name}</a><span>/</span>` : ''}${p.category_slug ? html`<a href="/category/${p.category_slug}">${p.category_name}</a><span>/</span>` : ''}<b>${p.name}</b></nav>
<div class="pdp">
  <div class="gallery" data-gallery>
    <div class="g-main">
      ${p.images.length ? html`<img src="${img(p.images[0])}" alt="${p.name}" data-g-main width="800" height="800" fetchpriority="high">` : html`<span class="ph big">${p.category_icon || '📱'}</span>`}
      <span class="badges">${p.discount_pct ? html`<b class="badge sale">-${p.discount_pct}%</b>` : ''}${p.badge ? html`<b class="badge">${p.badge}</b>` : ''}</span>
    </div>
    ${p.images.length > 1 ? html`<div class="g-thumbs">${p.images.map((id, i) => html`<button type="button" data-g-thumb="${img(id)}" class="${i ? '' : 'on'}" aria-label="صورة ${i + 1}"><img src="${img(id, 160)}" alt="" loading="lazy" width="80" height="80"></button>`)}</div>` : ''}
  </div>
  <div class="pdp-info">
    ${p.category_name ? html`<a class="card-cat" href="/category/${p.category_slug}">${p.category_icon} ${p.parent_name ? p.parent_name + ' · ' : ''}${p.category_name}</a>` : ''}
    <h1>${p.name}</h1>
    ${p.short_description ? html`<p class="lead">${p.short_description}</p>` : ''}
    ${a.key === 'ask' ? html`<div class="pdp-price ask"><strong>السعر عند الطلب</strong><small>تواصل معنا عبر واتساب أو الهاتف لمعرفة السعر والتوفر، وأسعار الجملة للمحلات.</small></div>` : html`<div class="pdp-price">
      <strong>${money(p.price)}</strong>${p.discount_pct ? html`<s>${money(p.compare_at_price)}</s><span class="save">وفّر ${money(p.compare_at_price - p.price)}</span>` : ''}
      <small>سعر القطاعي</small>
    </div>`}
    ${p.has_wholesale ? html`<div class="ws-box"><b>سعر الجملة: ${money(p.wholesale_price)}</b><span>يُطبَّق تلقائياً عند طلب ${p.wholesale_min_qty} قطع أو أكثر</span></div>` : ''}
    <ul class="specs">
      ${a.key === 'ask' ? '' : html`<li><span>الحالة</span><b class="stock ${a.key}">${a.label}</b></li>`}
      <li><span>رقم المنتج SKU</span><b dir="ltr">${p.sku}</b></li>
      ${p.brand ? html`<li><span>العلامة التجارية</span><b>${p.brand}</b></li>` : ''}
    </ul>
    ${a.key === 'ask' ? html`<div class="buy ask" data-ask>
      <span class="qty-label">الكمية</span><div class="qty" role="group" aria-label="الكمية"><button type="button" data-step="1" aria-label="زيادة">+</button><input type="number" value="1" min="1" max="999" inputmode="numeric" aria-label="الكمية" data-qty><button type="button" data-step="-1" aria-label="إنقاص">−</button></div>
    </div>
    <div class="buy-extra">
      ${s.whatsapp ? html`<button class="btn wa block lg" type="button" data-wa-product="${p.name}" data-wa-sku="${p.sku}" data-wa-url="/product/${p.slug}" data-wa-ask>${icons.wa} اطلب أو اسأل عن السعر عبر واتساب</button>` : html`<a class="btn primary block lg" href="/page/contact">تواصل معنا لمعرفة السعر</a>`}
      <button class="btn ghost block fav-lg" type="button" data-fav="${p.id}" aria-label="أضف إلى المفضلة" aria-pressed="false">${icons.heart} أضف إلى المفضلة</button>
    </div>` : html`<div class="buy" data-product="${p.id}" data-max="${p.stock}" data-retail="${p.price}" data-ws="${p.has_wholesale ? p.wholesale_price : ''}" data-ws-min="${p.wholesale_min_qty}">
      <div class="qty" role="group" aria-label="الكمية"><button type="button" data-step="1" aria-label="زيادة">+</button><input type="number" value="1" min="1" max="${Math.max(1, p.stock)}" inputmode="numeric" aria-label="الكمية" data-qty><button type="button" data-step="-1" aria-label="إنقاص">−</button></div>
      <button class="btn primary grow" type="button" data-add-qty="${p.id}" ${a.key === 'out' ? 'disabled' : ''}>${icons.cart} ${a.key === 'out' ? 'نفد المخزون' : 'أضف إلى السلة'}</button>
      <button class="btn icon fav-lg" type="button" data-fav="${p.id}" aria-label="أضف إلى المفضلة" aria-pressed="false">${icons.heart}</button>
    </div>
    <p class="unit-note" data-unit-note hidden></p>
    <div class="buy-extra">
      ${a.key !== 'out' ? html`<button class="btn dark block" type="button" data-buy-now="${p.id}">اشترِ الآن</button>` : ''}
      ${s.whatsapp ? html`<button class="btn wa block" type="button" data-wa-product="${p.name}" data-wa-sku="${p.sku}" data-wa-url="/product/${p.slug}">${icons.wa} اطلب أو اسأل عبر واتساب</button>` : ''}
    </div>`}
    <ul class="assure"><li>🚚 توصيل لجميع المدن الليبية</li><li>💵 الدفع عند الاستلام</li><li>🔁 استبدال للعيوب المصنعية</li></ul>
  </div>
</div>
${p.description ? html`<section class="block prose-box"><h2>وصف المنتج</h2><div class="prose">${md(p.description)}</div></section>` : ''}
${section('منتجات مشابهة', 'قد يعجبك أيضاً', p.category_slug ? '/category/' + p.category_slug : null, related)}
</div>`;
  return layout(req, {
    title: p.name, body, description: (p.short_description || p.name) + (p.price > 0 ? ` — ${money(p.price)}` : '') + ` | ${s.store_name}`,
    canonical: `/product/${p.slug}`, image: p.images[0] ? img(p.images[0]) : null, jsonld: ld, active: p.parent_slug ? 'cat:' + p.parent_slug : p.category_slug ? 'cat:' + p.category_slug : '',
  });
}

function cartPage(req) {
  const body = html`<div class="wrap narrow">
<nav class="crumbs"><a href="/">الرئيسية</a><span>/</span><b>سلة المشتريات</b></nav>
<h1 class="page-title">سلة المشتريات</h1>
<div class="cart-page">
  <div class="panel" data-cart-lines data-full><div class="empty-box sm"><p>جارِ التحميل...</p></div></div>
  <aside class="panel summary">
    <h2>ملخص الطلب</h2>
    <div class="row"><span>المجموع</span><b data-cart-subtotal>0 د.ل</b></div>
    <p class="hint" data-cart-savings hidden></p>
    <p class="muted small">تُحسب رسوم التوصيل وكود الخصم في الخطوة التالية.</p>
    <a class="btn primary block" href="/checkout" data-checkout-link>متابعة لإتمام الطلب</a>
    <a class="btn ghost block" href="/shop">متابعة التسوق</a>
  </aside>
</div></div>`;
  return layout(req, { title: 'سلة المشتريات', body, noindex: true });
}

function checkoutPage(req) {
  const s = getSettings();
  const methods = (s.payment_methods || []).filter((m) => m.enabled);
  const zones = s.shipping_zones || [];
  const body = html`<div class="wrap narrow">
<nav class="crumbs"><a href="/">الرئيسية</a><span>/</span><a href="/cart">السلة</a><span>/</span><b>إتمام الطلب</b></nav>
<h1 class="page-title">إتمام الطلب</h1>
<form class="checkout" id="checkoutForm" novalidate>
  <div class="co-main">
    <section class="panel">
      <h2><span class="step">1</span> بيانات المستلم</h2>
      <div class="fields">
        <label>الاسم الكامل *<input name="name" required maxlength="80" autocomplete="name" placeholder="مثال: محمد علي"></label>
        <label>رقم الهاتف *<input name="phone" required inputmode="tel" autocomplete="tel" dir="ltr" placeholder="09X XXX XXXX"><small>سنتواصل معك على هذا الرقم لتأكيد الطلب</small></label>
        <label class="full">منطقة التوصيل *
          <select name="zone" required>
            <option value="">اختر المنطقة</option>
            ${zones.map((z, i) => html`<option value="${i}">${z.name} — ${Number(z.fee) ? money(z.fee) : 'مجاناً'}</option>`)}
          </select>
        </label>
        <label class="full">العنوان بالتفصيل *<textarea name="address" required maxlength="300" rows="2" placeholder="الحي، الشارع، أقرب معلم"></textarea></label>
        <label class="full">ملاحظات على الطلب (اختياري)<textarea name="notes" maxlength="500" rows="2" placeholder="مثال: موديل الهاتف، وقت التوصيل المناسب"></textarea></label>
        <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      </div>
    </section>
    <section class="panel">
      <h2><span class="step">2</span> طريقة الدفع</h2>
      <div class="pay-methods">
        ${methods.map((m, i) => html`<label class="pay"><input type="radio" name="payment_method" value="${m.id}" ${i ? '' : 'checked'}><span><b>${m.name}</b><small>${m.instructions}</small></span></label>`)}
      </div>
    </section>
  </div>
  <aside class="panel summary co-summary">
    <h2><span class="step">3</span> مراجعة الطلب</h2>
    <div class="co-lines" data-co-lines><p class="muted">جارِ التحميل...</p></div>
    <div class="coupon"><input name="coupon" placeholder="كود الخصم" aria-label="كود الخصم" dir="ltr"><button class="btn ghost sm" type="button" data-apply-coupon>تطبيق</button></div>
    <p class="coupon-msg" data-coupon-msg hidden></p>
    <div class="row"><span>المجموع</span><b data-co="subtotal">—</b></div>
    <div class="row" data-co-row="discount" hidden><span>الخصم</span><b class="green" data-co="discount">—</b></div>
    <div class="row"><span>التوصيل</span><b data-co="shipping">اختر المنطقة</b></div>
    <div class="row total"><span>الإجمالي</span><b data-co="total">—</b></div>
    <p class="form-error" data-form-error hidden></p>
    <button class="btn primary block lg" type="submit" data-submit>تأكيد الطلب</button>
    <p class="muted small center">بالضغط على تأكيد الطلب أنت توافق على <a href="/page/shipping">سياسة الشحن والاستبدال</a>.</p>
  </aside>
</form></div>`;
  return layout(req, { title: 'إتمام الطلب', body, noindex: true, bodyClass: 'is-checkout' });
}

function statusTimeline(o) {
  const steps = ['new', 'processing', 'shipped', 'completed'];
  const labels = { new: 'جديد', processing: 'قيد التجهيز', shipped: 'تم الشحن', completed: 'مكتمل' };
  if (o.status === 'cancelled') return html`<div class="timeline cancelled"><b>❌ تم إلغاء هذا الطلب</b></div>`;
  const idx = steps.indexOf(o.status);
  return html`<ol class="timeline">${steps.map((st, i) => html`<li class="${i <= idx ? 'done' : ''} ${i === idx ? 'now' : ''}"><span></span>${labels[st]}</li>`)}</ol>`;
}

function orderSummary(o) {
  return html`<div class="order-box">
  <div class="order-head"><div><small>رقم الطلب</small><b dir="ltr">${o.number}</b></div><div><small>الحالة</small><b class="pill st-${o.status}">${o.status_label}</b></div><div><small>التاريخ</small><b>${new Date(o.created_at).toLocaleDateString('ar-LY', { timeZone: 'Africa/Tripoli' })}</b></div></div>
  ${statusTimeline(o)}
  <table class="items"><tbody>
    ${o.items.map((i) => html`<tr><td>${i.name}${i.price_type === 'wholesale' ? html` <small class="ws">جملة</small>` : ''}<small class="muted"> × ${i.qty}</small></td><td>${money(i.line_total)}</td></tr>`)}
  </tbody><tfoot>
    <tr><td>المجموع</td><td>${money(o.subtotal)}</td></tr>
    ${o.discount ? html`<tr><td>الخصم ${o.coupon_code ? html`<small dir="ltr">(${o.coupon_code})</small>` : ''}</td><td class="green">-${money(o.discount)}</td></tr>` : ''}
    <tr><td>التوصيل — ${o.city}</td><td>${money(o.shipping_fee)}</td></tr>
    <tr class="total"><td>الإجمالي</td><td>${money(o.total)}</td></tr>
  </tfoot></table>
  <p class="muted small">طريقة الدفع: ${o.payment_label}</p>
</div>`;
}

function orderSuccess(req, o) {
  const body = html`<div class="wrap narrow">
<div class="success-hero"><span class="check">✓</span><h1>تم استلام طلبك بنجاح</h1><p>شكراً لك ${o.customer_name}! سنتواصل معك على الرقم <b dir="ltr">${o.phone}</b> لتأكيد الطلب.</p></div>
${o.whatsapp_url ? html`<div class="panel wa-cta"><p><b>لتسريع التأكيد</b> أرسل تفاصيل الطلب إلينا عبر واتساب بضغطة واحدة.</p><a class="btn wa lg" href="${o.whatsapp_url}" target="_blank" rel="noopener" data-wa-text="${o.whatsapp_text}">${icons.wa} إرسال الطلب عبر واتساب</a></div>` : ''}
<p class="center"><a class="btn ghost" href="/invoice/${o.number}?t=${o.token}">🧾 عرض الفاتورة وطباعتها</a></p>
${orderSummary(o)}
<div class="center gap"><a class="btn ghost" href="/track?number=${encodeURIComponent(o.number)}">تتبع الطلب</a><a class="btn primary" href="/shop">متابعة التسوق</a></div>
</div>`;
  return layout(req, { title: 'تم استلام الطلب', body, noindex: true, bodyClass: 'order-done' });
}

function trackPage(req, { order, error, number, phone }) {
  const body = html`<div class="wrap narrow">
<nav class="crumbs"><a href="/">الرئيسية</a><span>/</span><b>تتبع الطلب</b></nav>
<h1 class="page-title">تتبع طلبك</h1>
<form class="panel track-form" method="get" action="/track">
  <label>رقم الطلب<input name="number" required value="${number || ''}" dir="ltr" placeholder="KH2611-0001"></label>
  <label>رقم الهاتف المستخدم في الطلب<input name="phone" required value="${phone || ''}" dir="ltr" inputmode="tel" placeholder="09X XXX XXXX"></label>
  <button class="btn primary" type="submit">بحث</button>
</form>
${error ? html`<p class="form-error">${error}</p>` : ''}
${order ? orderSummary(order) : ''}
</div>`;
  return layout(req, { title: 'تتبع الطلب', body, noindex: true, active: 'track' });
}

function favoritesPage(req) {
  const body = html`<div class="wrap">
<nav class="crumbs"><a href="/">الرئيسية</a><span>/</span><b>المفضلة</b></nav>
<h1 class="page-title">قائمة المفضلة</h1>
<div data-favorites><div class="empty-box"><p>جارِ التحميل...</p></div></div>
</div>`;
  return layout(req, { title: 'المفضلة', body, noindex: true, active: 'favs' });
}

function staticPage(req, page) {
  const s = getSettings();
  const isContact = page.slug === 'contact';
  const wa = String(s.whatsapp || '').replace(/\D/g, '');
  const body = html`<div class="wrap narrow">
<nav class="crumbs"><a href="/">الرئيسية</a><span>/</span><b>${page.title}</b></nav>
<article class="panel prose page"><h1>${page.title}</h1>${md(page.content)}</article>
${isContact ? html`<div class="contact-grid">
  <div class="panel contact-info">
    <h2>بيانات التواصل</h2>
    <ul>
      ${wa ? html`<li><span>واتساب</span><a dir="ltr" href="https://wa.me/${wa.startsWith('0') ? '218' + wa.slice(1) : wa}" target="_blank" rel="noopener">${s.whatsapp}</a></li>` : ''}
      ${s.phone ? html`<li><span>الهاتف</span><a dir="ltr" href="tel:${s.phone}">${s.phone}</a></li>` : ''}
      ${s.email ? html`<li><span>البريد</span><a href="mailto:${s.email}">${s.email}</a></li>` : ''}
      <li><span>العنوان</span><b>${s.address}</b></li>
      ${s.working_hours ? html`<li><span>ساعات العمل</span><b>${s.working_hours}</b></li>` : ''}
    </ul>
  </div>
  <form class="panel contact-form" id="contactForm" novalidate>
    <h2>أرسل رسالة</h2>
    <label>الاسم *<input name="name" required maxlength="80"></label>
    <label>رقم الهاتف<input name="phone" inputmode="tel" dir="ltr" maxlength="20"></label>
    <label>الموضوع<input name="subject" maxlength="120"></label>
    <label>الرسالة *<textarea name="body" required maxlength="2000" rows="4"></textarea></label>
    <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <p class="form-error" data-form-error hidden></p>
    <button class="btn primary" type="submit">إرسال</button>
  </form>
</div>` : ''}
</div>`;
  return layout(req, { title: page.title, body, canonical: `/page/${page.slug}` });
}

function notFound(req) {
  const body = html`<div class="wrap narrow"><div class="empty-box big"><span>🔍</span><h1>الصفحة غير موجودة</h1><p>ربما تم نقل الصفحة أو حذفها.</p><a class="btn primary" href="/shop">تصفّح المنتجات</a></div></div>`;
  return layout(req, { title: 'الصفحة غير موجودة', body, noindex: true });
}
function errorPage(req) {
  const body = html`<div class="wrap narrow"><div class="empty-box big"><span>⚠️</span><h1>حدث خطأ غير متوقع</h1><p>يرجى المحاولة مرة أخرى بعد قليل.</p><a class="btn primary" href="/">العودة للرئيسية</a></div></div>`;
  return layout(req, { title: 'خطأ', body, noindex: true });
}

module.exports = { layout, home, shop, categoriesPage, productPage, cartPage, checkoutPage, orderSuccess, trackPage, favoritesPage, staticPage, notFound, errorPage, grid, productCard, siteUrl, md };
