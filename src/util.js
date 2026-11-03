'use strict';
// Shared helpers: HTML escaping/templating, money, slugs, Arabic normalization, validation.

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s ?? ''));

function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}
function renderVal(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderVal).join('');
  return esc(v);
}
/** Tagged template: escapes every interpolation unless it is raw() or another html`` result. */
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += renderVal(vals[i]); });
  return new Raw(out);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function money(v) {
  const n = round2(v);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${s} د.ل`;
}

// Arabic-aware normalization for "smart" search.
function normalizeAr(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
// Libyan dialect + MSA + English names that mean the same thing (approved naming table).
// Every word in a group finds products written with any other word of the group.
const SYNONYM_GROUPS = [
  ['كفر', 'كفرات', 'جراب', 'جرابات', 'غطاء', 'حافظة', 'case', 'cover'],
  ['حماية', 'حمايات', 'لاصقة', 'لزقة', 'كسر', 'استيكر', 'ستيكر', 'واقي', 'سكرين', 'زجاج', 'glass'],
  ['شاحن', 'شواحن', 'charger', 'ادابتر', 'adapter'],
  ['راس', 'ادابتر', 'adapter'],
  ['وصلة', 'وصلات', 'خيط', 'كابل', 'كيبل', 'cable'],
  ['سماعة', 'سماعات', 'هيدفون', 'هيدسيت', 'headphone', 'headphones', 'headset'],
  ['ايربودز', 'ايربود', 'airpods', 'earbuds'],
  ['هاندز', 'هاندزفري', 'earphone', 'handsfree'],
  ['رقبة', 'نيك', 'neckband'],
  ['باور', 'powerbank', 'متنقلة'],
  ['تلفون', 'تليفون', 'موبايل', 'هاتف', 'جوال', 'نقال'],
  ['ايفون', 'iphone', 'ابل', 'apple', 'لايتننق', 'lightning'],
  ['سامسونج', 'سامسونق', 'samsung', 'جلكسي', 'جالكسي', 'galaxy'],
  ['تايب', 'تايبسي', 'typec', 'type'],
  ['سي', 'c'],
  ['مايكرو', 'micro'],
  ['ماكينة', 'ماكينات', 'زيان', 'حلاقة', 'كلبر', 'clipper', 'تريمر', 'trimmer', 'تحديد', 'شيفر', 'shaver'],
  ['جويستيك', 'دراع', 'gamepad', 'controller', 'تحكم'],
  ['ساعة', 'ساعات', 'watch'],
  ['حامل', 'ستاند', 'ماسك', 'holder', 'stand'],
  ['الترا', 'ultra'], ['برو', 'pro'], ['ماكس', 'max'], ['تكنو', 'tecno'], ['هونر', 'honor'], ['شاومي', 'xiaomi', 'mi', 'ريدمي', 'redmi'],
  ['مشغل', 'ترانسمتر', 'fm', 'mp3'],
  ['خصوصيه', 'privacy', 'تجسس'],
  ['مغناطيسي', 'مغناطيس', 'ماجسيف', 'ماقسيف', 'magsafe'], ['جاكيت', 'منفوخ', 'puffer'], ['مطفي', 'مط', 'matte'], ['رمادي', 'رصاصي', 'grey', 'gray'], ['ابيض', 'white'],
  ['سبارك', 'spark'], ['جلد', 'جلدي', 'leather'], ['شفاف', 'clear', 'ترانسبيرنت'], ['حلقة', 'رنج', 'رينج', 'ring', 'خاتم'], ['جيب', 'كروت', 'كارت', 'card'],
  ['اسود', 'black'], ['بني', 'قهوي', 'brown'], ['اخضر', 'green'], ['فضي', 'silver'], ['بنفسجي', 'موف', 'purple'], ['برتقالي', 'برتقاني', 'orange'], ['كحلي', 'navy'],
];
const SYNONYMS = {};
for (const g of SYNONYM_GROUPS) {
  const n = g.map((w) => normalizeAr(w));
  for (const w of n) SYNONYMS[w] = [...new Set([...(SYNONYMS[w] || []), ...n.filter((x) => x !== w)])];
}
function searchTokens(q) {
  return normalizeAr(q).split(' ').filter((t) => t.length > 0).slice(0, 8);
}

function slugify(s) {
  const base = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'item';
}

// Libyan phone normalization: accepts 09xxxxxxxx, 9xxxxxxxx, +2189xxxxxxxx, 002189xxxxxxxx.
function normalizePhone(p) {
  let d = String(p ?? '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('218')) d = '0' + d.slice(3);
  if (/^9\d{8}$/.test(d)) d = '0' + d;
  return d;
}
const isValidPhone = (d) => /^0\d{8,9}$/.test(d) || /^\d{10,15}$/.test(d);
function phoneIntl(d) {
  if (/^0\d{8,9}$/.test(d)) return '218' + d.slice(1);
  return d;
}

// --- Minimal schema validation (zero-dependency) ---
class ValidationError extends Error {
  constructor(errors) { super('بيانات غير صالحة'); this.status = 400; this.errors = errors; }
}
/**
 * schema: { field: { type:'string'|'number'|'int'|'bool'|'enum'|'array', required, min, max, values, default, trim } }
 */
function validate(input, schema) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {}; const errors = {};
  for (const [k, r] of Object.entries(schema)) {
    let v = src[k];
    const label = r.label || k;
    if (v === undefined || v === null || v === '') {
      if (r.required) { errors[k] = `${label} مطلوب`; continue; }
      if ('default' in r) out[k] = typeof r.default === 'function' ? r.default() : r.default;
      else out[k] = r.type === 'bool' ? false : null;
      continue;
    }
    switch (r.type) {
      case 'string': {
        v = String(v);
        if (r.trim !== false) v = v.trim();
        if (r.required && !v) { errors[k] = `${label} مطلوب`; continue; }
        if (r.min && v.length < r.min) { errors[k] = `${label} قصير جداً`; continue; }
        if (r.max && v.length > r.max) { errors[k] = `${label} طويل جداً (الحد ${r.max})`; continue; }
        if (r.pattern && v && !r.pattern.test(v)) { errors[k] = r.patternMsg || `${label} غير صالح`; continue; }
        out[k] = v; break;
      }
      case 'number': case 'int': {
        const n = Number(String(v).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))));
        if (!Number.isFinite(n) || (r.type === 'int' && !Number.isInteger(n))) { errors[k] = `${label} يجب أن يكون رقماً${r.type === 'int' ? ' صحيحاً' : ''}`; continue; }
        if (r.min !== undefined && n < r.min) { errors[k] = `${label} يجب ألا يقل عن ${r.min}`; continue; }
        if (r.max !== undefined && n > r.max) { errors[k] = `${label} يجب ألا يزيد عن ${r.max}`; continue; }
        out[k] = r.type === 'number' ? round2(n) : n; break;
      }
      case 'bool': out[k] = v === true || v === 1 || v === '1' || v === 'true' || v === 'on'; break;
      case 'enum':
        if (!r.values.includes(v)) { errors[k] = `${label} غير صالح`; continue; }
        out[k] = v; break;
      case 'array':
        if (!Array.isArray(v)) { errors[k] = `${label} غير صالح`; continue; }
        if (r.max && v.length > r.max) { errors[k] = `${label}: عدد كبير جداً`; continue; }
        out[k] = v; break;
      default: out[k] = v;
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

const STATUS = {
  new: 'جديد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

function nowIso() { return new Date().toISOString(); }
function randomToken(bytes = 16) { return require('crypto').randomBytes(bytes).toString('base64url'); }

module.exports = {
  Raw, raw, esc, html, round2, money, normalizeAr, searchTokens, SYNONYMS, slugify,
  normalizePhone, isValidPhone, phoneIntl, validate, ValidationError, STATUS, nowIso, randomToken,
};
