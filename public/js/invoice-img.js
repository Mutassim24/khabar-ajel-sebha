/* Fills the shop's real paper invoice (public/img/invoice-template.webp, 1024×1536) on a canvas:
   number, cash/credit tick, date, customer, 20 item rows (more items → extra pages), totals, amount in words, phone.
   The picture is what the customer sends to WhatsApp and what the invoice page shows and prints.
   Usage: var inv = KAInvoice.attach(dataElement); inv.update({paid, credit}) re-draws. */
(function () {
  'use strict';
  var TPL = '/img/invoice-template.webp?v=1', S = 1.5, ROWS = 20;
  var F = 'Cairo, "Segoe UI", Tahoma, Arial, sans-serif', NAVY = '#011639', BLUE = '#1290fb';
  // row boundaries measured on the template (y of each ruled line)
  var LINES = [428, 466, 501, 537, 571, 605, 640, 675, 709, 744, 779, 815, 850, 885, 920, 954, 990, 1024, 1059, 1094, 1131];
  // column centres / edges (x) — the template's money columns are [دينار | درهم] from left to right
  var COL = { m: 966, descR: 916, descW: 392, qty: 462, uD: 276, uH: 365, tD: 78, tH: 175 };

  var split = function (v) {
    if (v === '' || v === null || v === undefined) return ['', ''];
    var t = Math.round(Number(v) * 1000), neg = t < 0, a = Math.abs(t);
    return [(neg ? '-' : '') + Math.floor(a / 1000).toLocaleString('en-US'), a % 1000 ? String(a % 1000).padStart(3, '0') : ''];
  };
  var money = function (v) { return (Math.round(Number(v) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' د.ل'; };

  function font(ctx, size, w) { ctx.font = (w || 700) + ' ' + size + 'px ' + F; }
  // draw text, shrinking it until it fits maxW (down to min), then cutting it with …
  function fit(ctx, s, x, y, o) {
    s = String(s == null ? '' : s); if (!s) return;
    var size = o.size || 20, min = o.min || 12;
    ctx.direction = o.dir || 'rtl'; ctx.textAlign = o.align || 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = o.color || NAVY;
    font(ctx, size, o.w);
    while (o.maxW && ctx.measureText(s).width > o.maxW && size > min) { size -= 1; font(ctx, size, o.w); }
    if (o.maxW && ctx.measureText(s).width > o.maxW) { while (s.length > 1 && ctx.measureText(s + '…').width > o.maxW) s = s.slice(0, -1); s += '…'; }
    ctx.fillText(s, x, y);
  }
  // item name: one line if it fits at a readable size, otherwise two lines inside the row
  function desc(ctx, name, y) {
    name = String(name || ''); var w = COL.descW;
    font(ctx, 16, 700);
    if (ctx.measureText(name).width <= w) { fit(ctx, name, COL.descR, y, { size: 20, min: 16, w: 700, maxW: w }); return; }
    // prefer breaking at « — » (model / colour parts), otherwise between words, where the two lines are most even
    var seps = name.indexOf(' — ') > -1 ? ' — ' : ' ', parts = name.split(seps), best = 1, bestDiff = 1e9;
    if (parts.length < 2) { seps = ' '; parts = name.split(' '); }
    font(ctx, 13, 700);
    for (var i = 1; i < parts.length; i++) {
      var d = Math.abs(ctx.measureText(parts.slice(0, i).join(seps)).width - ctx.measureText(parts.slice(i).join(seps)).width);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    fit(ctx, parts.slice(0, best).join(seps), COL.descR, y - 7.5, { size: 13, min: 11, w: 700, maxW: w });
    fit(ctx, parts.slice(best).join(seps), COL.descR, y + 8, { size: 13, min: 11, w: 700, maxW: w });
  }
  function tick(ctx, x, y) { // ✓ inside a 30px box whose top-left is x,y
    ctx.strokeStyle = BLUE; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x + 6, y + 16); ctx.lineTo(x + 13, y + 24); ctx.lineTo(x + 27, y + 5); ctx.stroke();
  }

  var tplImg = null;
  function loadTemplate() {
    if (!tplImg) tplImg = new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('تعذّر تحميل قالب الفاتورة')); }; i.src = TPL; });
    return tplImg;
  }

  function drawPage(img, d, page, pages) {
    var c = document.createElement('canvas'); c.width = 1024 * S; c.height = 1536 * S;
    var ctx = c.getContext('2d'); ctx.scale(S, S);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1024, 1536); ctx.drawImage(img, 0, 0, 1024, 1536);

    // invoice number (+ page n of m)
    fit(ctx, d.number, 396, 249, { size: 30, min: 16, w: 900, color: BLUE, align: 'center', dir: 'ltr', maxW: 150 });
    if (pages > 1) fit(ctx, 'صفحة ' + (page + 1) + ' من ' + pages, 543, 214, { size: 16, w: 800, align: 'center' });
    // cash / credit
    if (d.credit) tick(ctx, 39, 212); else tick(ctx, 162, 212);
    // date dd / mm / yyyy (written right-to-left into the three blanks)
    var dt = String(d.date || '').split('/');
    if (dt.length === 3) {
      fit(ctx, dt[0], 189, 297, { size: 22, w: 800, align: 'center', dir: 'ltr' });
      fit(ctx, dt[1], 121, 297, { size: 22, w: 800, align: 'center', dir: 'ltr' });
      fit(ctx, dt[2], 50, 297, { size: 22, w: 800, align: 'center', dir: 'ltr' });
    }
    // customer (name only — the phone has its own line at the bottom)
    fit(ctx, d.customer, 872, 297, { size: 24, min: 14, w: 800, maxW: 540 });

    // rows
    var rows = (d.rows || []).slice(page * ROWS, page * ROWS + ROWS);
    rows.forEach(function (r, k) {
      var y = (LINES[k] + LINES[k + 1]) / 2 + 1;
      desc(ctx, r.name, y);
      fit(ctx, r.qty, COL.qty, y, { size: 20, w: 800, align: 'center', dir: 'ltr', maxW: 76 });
      var u = split(r.unit), t = split(r.total);
      fit(ctx, u[0], COL.uD, y, { size: 19, min: 12, w: 800, align: 'center', dir: 'ltr', maxW: 80 });
      fit(ctx, u[1], COL.uH, y, { size: 19, w: 700, align: 'center', dir: 'ltr' });
      fit(ctx, t[0], COL.tD, y, { size: 19, min: 12, w: 800, align: 'center', dir: 'ltr', maxW: 90 });
      fit(ctx, t[1], COL.tH, y, { size: 19, w: 700, align: 'center', dir: 'ltr' });
    });

    if (page > 0) { // the paper is numbered 1–20: continuation pages carry on 21, 22, …
      for (var k = 0; k < ROWS; k++) {
        var yy = (LINES[k] + LINES[k + 1]) / 2 + 1;
        ctx.fillStyle = '#fff'; ctx.fillRect(941, LINES[k] + 4, 50, LINES[k + 1] - LINES[k] - 7);
        fit(ctx, page * ROWS + k + 1, COL.m, yy, { size: 19, w: 800, align: 'center', dir: 'ltr' });
      }
    }
    var last = page === pages - 1;
    if (last) {
      fit(ctx, money(d.total), 146, 1176, { size: 22, min: 14, w: 900, align: 'center', maxW: 220 });
      fit(ctx, money(d.paid), 146, 1227, { size: 21, min: 14, w: 800, align: 'center', maxW: 220 });
      fit(ctx, money(d.remaining), 146, 1278, { size: 21, min: 14, w: 800, align: 'center', maxW: 220, color: d.remaining > 0 ? '#c62828' : NAVY });
      // amount in words: one line (shrunk if needed), otherwise two lines inside the box
      var words = String(d.words || ''), maxW = 370, sz = 19;
      font(ctx, sz, 800); while (ctx.measureText(words).width > maxW && sz > 13) { sz -= 1; font(ctx, sz, 800); }
      if (ctx.measureText(words).width <= maxW) fit(ctx, words, 806, 1177, { size: sz, w: 800 });
      else {
        var parts = words.split(' '), mid = Math.ceil(parts.length / 2);
        fit(ctx, parts.slice(0, mid).join(' '), 806, 1168, { size: 14, min: 11, w: 800, maxW: maxW });
        fit(ctx, parts.slice(mid).join(' '), 806, 1187, { size: 14, min: 11, w: 800, maxW: maxW });
      }
    } else {
      fit(ctx, 'يتبع في الصفحة التالية ←', 805, 1177, { size: 18, w: 800, maxW: 368 });
    }
    // phone line (the template's address line — orders are picked up from the shop)
    fit(ctx, 'الهاتف :', 996, 1412, { size: 23, w: 800 });
    fit(ctx, d.phone, 698, 1408, { size: 23, w: 800, align: 'center', dir: 'ltr', maxW: 360 });
    if (d.pickup) fit(ctx, '📍 ' + d.pickup, 995, 1232, { size: 15, min: 11, w: 700, maxW: 560, color: '#4a5468' });
    return c;
  }

  function render(d) {
    var fontsReady = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load('900 30px Cairo'), document.fonts.load('700 20px Cairo'), document.fonts.load('800 20px Cairo')]).catch(function () {})
      : Promise.resolve();
    return Promise.all([loadTemplate(), fontsReady]).then(function (r) {
      var pages = Math.max(1, Math.ceil((d.rows || []).length / ROWS)), out = [];
      for (var p = 0; p < pages; p++) out.push(drawPage(r[0], d, p, pages));
      return Promise.all(out.map(function (c) { return new Promise(function (res) { c.toBlob(res, 'image/png'); }); }));
    });
  }

  window.KAInvoice = {
    render: render,
    attach: function (el) {
      if (!el) return null;
      var d = JSON.parse(el.dataset.json), ready = null, urls = [];
      var name = function (i, n) { return 'فاتورة-' + d.number + (n > 1 ? '-' + (i + 1) : '') + '.png'; };
      var build = function () { if (!ready) ready = render(d); return ready; };
      var show = function () {
        return build().then(function (blobs) {
          urls.forEach(function (u) { URL.revokeObjectURL(u); });
          urls = blobs.map(function (b) { return URL.createObjectURL(b); });
          document.querySelectorAll('[data-inv-preview]').forEach(function (img) { img.src = urls[0]; img.hidden = false; });
          document.querySelectorAll('[data-inv-sheets]').forEach(function (box) {
            box.innerHTML = '';
            urls.forEach(function (u, i) { var im = new Image(); im.src = u; im.alt = 'الفاتورة ' + d.number + (urls.length > 1 ? ' — صفحة ' + (i + 1) : ''); im.className = 'sheet'; box.appendChild(im); });
          });
        }).catch(function (e) {
          document.querySelectorAll('[data-inv-sheets]').forEach(function (box) { box.textContent = e.message + ' — حدّث الصفحة.'; });
        });
      };
      var download = function (blob, fn) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click(); a.remove(); };
      show();
      document.addEventListener('click', function (e) {
        var sh = e.target.closest('[data-inv-share]'), dl = e.target.closest('[data-inv-download]');
        if (!sh && !dl) return;
        e.preventDefault();
        build().then(function (blobs) {
          if (dl) { blobs.forEach(function (b, i) { download(b, name(i, blobs.length)); }); return; }
          var files = blobs.map(function (b, i) { return new File([b], name(i, blobs.length), { type: 'image/png' }); });
          var text = 'فاتورة رقم ' + d.number + ' — ' + d.customer + ' — الإجمالي ' + money(d.total);
          if (navigator.canShare && navigator.canShare({ files: files })) {
            navigator.share({ files: files, text: text, title: 'فاتورة ' + d.number }).catch(function () {});
          } else {
            // computers / older phones: save the picture, then open the shop chat so it can be attached
            blobs.forEach(function (b, i) { download(b, name(i, blobs.length)); });
            var n = (el.dataset.wa || '').split(',')[0];
            if (n) window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(text + '\n(صورة الفاتورة محفوظة على جهازك، أرفقها هنا)'), '_blank', 'noopener');
          }
        });
      });
      return {
        data: d,
        update: function (patch) {
          Object.keys(patch).forEach(function (k) { d[k] = patch[k]; });
          d.remaining = Math.round((d.total - d.paid) * 1000) / 1000;
          ready = null; return show();
        },
      };
    },
  };
  document.addEventListener('DOMContentLoaded', function () { window.KAInvoiceCtl = window.KAInvoice.attach(document.getElementById('inv-data')); });
})();
