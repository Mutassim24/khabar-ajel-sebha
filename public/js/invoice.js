/* Invoice page: print, and (admin) live "remaining" + save paid amount / cash-credit */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var pb = $('[data-print]'); if (pb) pb.onclick = function () { window.print(); };
  // show the whole paper invoice on phones: scale it down to the screen width (pinch to zoom in)
  var inv = $('.inv'); var fit = function () { inv.style.zoom = Math.min(1, (document.documentElement.clientWidth - 8) / 796); };
  if (inv) { fit(); window.addEventListener('resize', fit); }
  var paid = $('[data-paid]'); if (!paid) return;
  var total = Number(document.body.dataset.total) || 0, save = $('[data-save]'), msg = $('[data-msg]');
  var fmt = function (v) { return (Math.round(v * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' د.ل'; };
  var dirty = function () { save.hidden = false; msg.textContent = ''; $('[data-remaining]').textContent = fmt(total - (Number(paid.value) || 0)); };
  paid.addEventListener('input', dirty);
  document.querySelectorAll('input[name=terms]').forEach(function (r) { r.addEventListener('change', dirty); });
  save.onclick = function () {
    var v = Number(paid.value);
    if (!(v >= 0)) { msg.textContent = 'أدخل مبلغاً صحيحاً'; return; }
    save.disabled = true; msg.textContent = 'جارِ الحفظ...';
    fetch('/api/admin/orders/' + document.body.dataset.order + '/invoice', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ paid_amount: v, payment_terms: $('input[name=terms]:checked').value }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'تعذّر الحفظ'); }); })
      .then(function () { msg.textContent = 'تم الحفظ ✓'; save.hidden = true; })
      .catch(function (e) { msg.textContent = e.message === 'Failed to fetch' ? 'تعذّر الاتصال، حاول مرة أخرى' : e.message; })
      .then(function () { save.disabled = false; });
  };
})();
