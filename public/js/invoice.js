/* Invoice page: print, and (admin) cash/credit + paid amount — the picture re-draws live, then "حفظ" stores it. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var pb = $('[data-print]'); if (pb) pb.onclick = function () { window.print(); };
  var paid = $('[data-paid]'); if (!paid) return;
  var save = $('[data-save]'), msg = $('[data-msg]');
  var num = function (v) { return Number(String(v).replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); }).replace(/[٫,]/g, '.').trim()); };
  var fmt = function (v) { return (Math.round(v * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' د.ل'; };
  var credit = function () { return $('input[name=terms]:checked').value === 'credit'; };
  var dirty = function () {
    save.hidden = false; msg.textContent = '';
    var v = num(paid.value); if (!(v >= 0)) return;
    var total = Number(document.body.dataset.total) || 0;
    $('[data-remaining]').textContent = fmt(total - v);
    if (window.KAInvoiceCtl) window.KAInvoiceCtl.update({ paid: v, credit: credit() });
  };
  paid.addEventListener('input', dirty);
  document.querySelectorAll('input[name=terms]').forEach(function (r) { r.addEventListener('change', dirty); });
  save.onclick = function () {
    var v = num(paid.value);
    if (!(v >= 0)) { msg.textContent = 'أدخل مبلغاً صحيحاً'; return; }
    save.disabled = true; msg.textContent = 'جارِ الحفظ...';
    fetch('/api/admin/orders/' + document.body.dataset.order + '/invoice', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ paid_amount: v, payment_terms: credit() ? 'credit' : 'cash' }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'تعذّر الحفظ'); }); })
      .then(function () { msg.textContent = 'تم الحفظ ✓'; save.hidden = true; })
      .catch(function (e) { msg.textContent = e.message === 'Failed to fetch' ? 'تعذّر الاتصال، حاول مرة أخرى' : e.message; })
      .then(function () { save.disabled = false; });
  };
})();
