// Invoice data for the shop's paper invoice (فاتورة خبر عاجل). The browser draws it onto the scanned template
// (public/js/invoice-img.js): 20 rows per page, دينار / درهم columns (1 دينار = 1000 درهم), totals and the amount in words.
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

/** Shop WhatsApp numbers in international form (09x… → 2189x…). */
const waNumbers = (s) => [s.whatsapp, s.whatsapp2].map((n) => String(n || '').replace(/\D/g, '')).filter(Boolean).map((n) => (n.startsWith('0') ? '218' + n.slice(1) : n)).join(',');

const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { timeZone: 'Africa/Tripoli' }); };
const money3 = (v) => (Math.round((Number(v) || 0) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });

function invoiceRows(o) {
  const rows = o.items.map((i) => ({ name: i.name + (i.price_type === 'wholesale' ? ' (جملة)' : ''), qty: i.qty, unit: i.unit_price, total: i.line_total }));
  if (o.discount > 0) rows.push({ name: 'خصم' + (o.coupon_code ? ` (${o.coupon_code})` : ''), qty: '', unit: '', total: -o.discount });
  if (o.shipping_fee > 0) rows.push({ name: `رسوم التوصيل — ${o.city || ''}`, qty: 1, unit: o.shipping_fee, total: o.shipping_fee });
  return rows;
}
/** Plain data for drawing the invoice as an image in the browser (sent to WhatsApp as a picture). */
function invoiceData(o) {
  const paid = o.paid_amount == null ? (o.status === 'completed' ? o.total : 0) : o.paid_amount;
  return {
    number: o.number, date: fmtDate(o.created_at), customer: o.customer_name, phone: o.phone, credit: o.payment_terms === 'credit',
    rows: invoiceRows(o).map((r) => ({ name: r.name, qty: r.qty, unit: r.unit, total: r.total })),
    total: o.total, paid, remaining: Math.round((o.total - paid) * 1000) / 1000, words: amountInWords(o.total),
    payment: o.payment_label || o.payment_method, pickup: o.shipping_fee > 0 ? '' : (o.city || ''),
  };
}
function invoicePage({ order: o, settings: s, isAdmin }) {
  const rows = invoiceRows(o);
  const data = invoiceData(o);
  const credit = data.credit;
  return '<!doctype html>' + String(html`<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>فاتورة ${o.number} | ${s.store_name}</title>
<link rel="preload" href="/fonts/cairo.woff?v=1" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="/css/invoice.css?v=4"></head>
<body data-order="${o.id}" data-total="${o.total}">
<div class="bar no-print">
  ${isAdmin ? html`<a href="/admin#/orders/${o.id}">← رجوع للطلب</a>` : html`<a href="/order/${o.number}?t=${o.token}">← رجوع للطلب</a>`}
  <button type="button" class="share" data-inv-share>📤 إرسال صورة الفاتورة (واتساب)</button>
  <button type="button" data-inv-download>⬇ حفظ صورة</button>
  <button type="button" data-print>🖨 طباعة / PDF</button>
</div>
${isAdmin ? html`<div class="adm no-print">
  <label><input type="radio" name="terms" value="cash" ${credit ? '' : raw('checked')}> نقداً</label>
  <label><input type="radio" name="terms" value="credit" ${credit ? raw('checked') : ''}> آجلاً</label>
  <label>المدفوع <input type="text" inputmode="decimal" value="${data.paid}" data-paid dir="ltr"> د.ل</label>
  <span>الباقي: <b data-remaining>${money3(data.remaining)} د.ل</b></span>
  <button type="button" data-save hidden>💾 حفظ</button><span class="msg" data-msg></span>
</div>` : ''}
<main class="sheets" data-inv-sheets><p class="loading">جارِ تجهيز الفاتورة...</p></main>
<div class="sr-only"><table aria-label="تفاصيل الفاتورة">
  <thead><tr><th>م</th><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>السعر الإجمالي</th></tr></thead>
  <tbody>${rows.map((r, k) => html`<tr><td>${k + 1}</td><td>${r.name}</td><td>${r.qty}</td><td>${r.unit === '' ? '' : money3(r.unit)}</td><td>${money3(r.total)}</td></tr>`)}</tbody>
  <tfoot><tr><td colspan="4">الزبون: ${o.customer_name} · الهاتف: ${o.phone || ''} · التاريخ: ${fmtDate(o.created_at)}</td><td>${money3(o.total)} د.ل — ${amountInWords(o.total)}</td></tr></tfoot>
</table></div>
<div hidden id="inv-data" data-json="${JSON.stringify(data)}" data-wa="${waNumbers(s)}"></div>
<script src="/js/invoice-img.js?v=7"></script>
<script src="/js/invoice.js?v=5"></script>
</body></html>`);
}

module.exports = { invoicePage, invoiceData, amountInWords, numberWords, waNumbers };
