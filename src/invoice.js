// Printable invoice in the shop's paper layout (فاتورة خبر عاجل): items, qty, unit price, line total
// split into دينار / درهم (1 دينار = 1000 درهم), automatic sum, paid, remaining, and the amount in words.
'use strict';
const { html, raw } = require('./util');

/* ---------- amount in Arabic words (تفقيط) ---------- */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
function below1000(n) {
  const h = Math.floor(n / 100); const r = n % 100; const parts = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) parts.push(r < 20 ? ONES[r] : (r % 10 ? ONES[r % 10] + ' و' : '') + TENS[Math.floor(r / 10)]);
  return parts.join(' و');
}
// scale words: [singular, dual, plural (3-10), accusative (11-99)]
function scaled(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return below1000(n) + ' ' + few;
  const r = n % 100;
  return below1000(n) + ' ' + (r === 0 ? one : r <= 2 ? one : r <= 10 ? few : many);
}
function numberWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const parts = [];
  const m = Math.floor(n / 1e6); const k = Math.floor((n % 1e6) / 1000); const r = n % 1000;
  // when a scale word is the last word before the counted noun it takes the construct form (ألفا دينار، أحد عشر ألف دينار)
  if (m) parts.push(scaled(m, !k && !r ? ['مليون', 'مليونا', 'ملايين', 'مليون'] : ['مليون', 'مليونان', 'ملايين', 'مليوناً']));
  if (k) parts.push(scaled(k, !r ? ['ألف', 'ألفا', 'آلاف', 'ألف'] : ['ألف', 'ألفان', 'آلاف', 'ألفاً']));
  if (r) parts.push(below1000(r));
  return parts.join(' و');
}
function counted(n, [one, two, few, many]) {
  if (n === 1) return one + ' واحد';
  if (n === 2) return two;
  const r = n % 100;
  const noun = r >= 3 && r <= 10 ? few : r >= 11 ? many : one;
  return numberWords(n) + ' ' + noun;
}
function amountInWords(v) {
  const total = Math.round(Math.abs(Number(v) || 0) * 1000);
  const d = Math.floor(total / 1000); const dh = total % 1000;
  if (!d && !dh) return 'صفر دينار';
  const parts = [];
  if (d) parts.push(counted(d, ['دينار', 'ديناران', 'دنانير', 'ديناراً']));
  if (dh) parts.push(counted(dh, ['درهم', 'درهمان', 'دراهم', 'درهماً']));
  return 'فقط ' + parts.join(' و') + ' لا غير';
}

/* ---------- money split ---------- */
const split = (v) => { const t = Math.round((Number(v) || 0) * 1000); const neg = t < 0; const a = Math.abs(t); return { d: (neg ? '-' : '') + Math.floor(a / 1000).toLocaleString('en-US'), h: String(a % 1000).padStart(3, '0') }; };
const cells = (v) => { const s = split(v); return html`<td class="dn">${s.d}</td><td class="dh">${s.h}</td>`; };
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { timeZone: 'Africa/Tripoli' }); };
const money3 = (v) => (Math.round((Number(v) || 0) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });

function invoicePage({ order: o, settings: s, isAdmin }) {
  const rows = o.items.map((i) => ({ name: i.name + (i.price_type === 'wholesale' ? ' (جملة)' : ''), sku: i.sku, qty: i.qty, unit: i.unit_price, total: i.line_total }));
  if (o.discount > 0) rows.push({ name: 'خصم' + (o.coupon_code ? ` (${o.coupon_code})` : ''), qty: '', unit: '', total: -o.discount });
  if (o.shipping_fee > 0) rows.push({ name: `رسوم التوصيل — ${o.city || ''}`, qty: 1, unit: o.shipping_fee, total: o.shipping_fee });
  const n = Math.max(20, rows.length);
  const paid = o.paid_amount == null ? (o.status === 'completed' ? o.total : 0) : o.paid_amount;
  const remaining = Math.round((o.total - paid) * 1000) / 1000;
  const credit = o.payment_terms === 'credit';
  const title = s.invoice_title || s.store_name;
  return '<!doctype html>' + String(html`<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>فاتورة ${o.number} | ${s.store_name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap">
<link rel="stylesheet" href="/css/invoice.css?v=1"></head>
<body data-order="${o.id}" data-total="${o.total}">
<div class="bar no-print">
  ${isAdmin ? html`<a href="/admin#/orders/${o.id}">← رجوع للطلب</a>` : html`<a href="/order/${o.number}?t=${o.token}">← رجوع للطلب</a>`}
  <button type="button" data-print>🖨 طباعة / حفظ PDF</button>
  ${isAdmin ? html`<button type="button" data-save hidden>💾 حفظ المدفوع ونوع الدفع</button><span class="msg" data-msg></span>` : ''}
</div>
<main class="inv">
  <header class="top">
    <div class="shop">
      <h1>${title}</h1>
      <p class="sub">${s.invoice_subtitle || s.tagline}</p>
      <p class="tag">${s.invoice_tagline || 'جملة - قطاعي'}</p>
    </div>
    <div class="brands">${(s.invoice_brands || '').split(/[,،·]/).map((b) => b.trim()).filter(Boolean).map((b) => html`<span>${b}</span>`)}</div>
  </header>
  <div class="row2">
    <div class="addr">${s.invoice_address || s.address}</div>
    <div class="num"><small>فاتورة رقم<br><i>INVOICE</i></small><b dir="ltr">${o.number}</b></div>
    <div class="terms">
      ${isAdmin ? html`<label><input type="radio" name="terms" value="cash" ${credit ? '' : raw('checked')}> نقداً</label><label><input type="radio" name="terms" value="credit" ${credit ? raw('checked') : ''}> أجل</label>`
    : html`<span class="box ${credit ? '' : 'on'}"></span> نقداً <span class="box ${credit ? 'on' : ''}"></span> أجل`}
    </div>
  </div>
  <div class="who">
    <span class="lbl">الزبون</span><span class="fld">${o.customer_name}${o.phone ? html`<bdi dir="ltr" class="ph">${o.phone}</bdi>` : ''}</span>
    <span class="lbl plain">التاريخ</span><span class="fld date" dir="ltr">${fmtDate(o.created_at)}</span>
  </div>
  <table class="items">
    <colgroup><col class="c-m"><col class="c-desc"><col class="c-q"><col class="c-d"><col class="c-h"><col class="c-d"><col class="c-h"></colgroup>
    <thead>
      <tr><th rowspan="2">م</th><th rowspan="2">البيـــــان</th><th rowspan="2">الكمية</th><th colspan="2">سعر الوحدة</th><th colspan="2">السعر الإجمالي</th></tr>
      <tr><th class="sm">دينـار</th><th class="sm">درهم</th><th class="sm">دينـار</th><th class="sm">درهم</th></tr>
    </thead>
    <tbody>
      ${Array.from({ length: n }, (_, k) => { const r = rows[k]; return r
    ? html`<tr><td class="m">${k + 1}</td><td class="desc">${r.name}${r.sku ? html` <small dir="ltr">${r.sku}</small>` : ''}</td><td class="q">${r.qty}</td>${r.unit === '' ? raw('<td></td><td></td>') : cells(r.unit)}${cells(r.total)}</tr>`
    : html`<tr class="empty"><td class="m">${k + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`; })}
    </tbody>
  </table>
  <section class="sums">
    <div class="words"><span class="lbl">المبلغ بالحروف</span><span class="fld">${amountInWords(o.total)}</span></div>
    <div class="totals">
      <div><span>المجموع</span><b>${money3(o.total)} د.ل</b></div>
      <div><span>المدفوع</span>${isAdmin ? html`<b><input type="number" min="0" step="0.001" value="${paid}" data-paid dir="ltr"> د.ل</b>` : html`<b>${money3(paid)} د.ل</b>`}</div>
      <div><span>البـاقـي</span><b data-remaining>${money3(remaining)} د.ل</b></div>
    </div>
  </section>
  <footer class="foot">
    <div class="phones">
      ${s.invoice_phones_1 ? html`<div><span>${s.invoice_city_1 || 'سبها'} :</span> <bdi dir="ltr">${s.invoice_phones_1}</bdi></div>` : ''}
      ${s.invoice_phones_2 ? html`<div><span>${s.invoice_city_2 || 'طرابلس'} :</span> <bdi dir="ltr">${s.invoice_phones_2}</bdi></div>` : ''}
    </div>
    <div class="sign">التوقيع والختم<i></i></div>
  </footer>
  <p class="meta">طريقة الدفع: ${o.payment_label || o.payment_method}${o.address ? html` · العنوان: ${o.city ? o.city + ' — ' : ''}${o.address}` : ''}</p>
</main>
<script src="/js/invoice.js?v=1"></script>
</body></html>`);
}

module.exports = { invoicePage, amountInWords, numberWords };
