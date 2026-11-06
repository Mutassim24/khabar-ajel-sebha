/* Draws the shop invoice (same layout as the paper invoice) on a canvas, so it can be sent to WhatsApp as a picture.
   Usage: KAInvoice.attach(dataElement) wires [data-inv-share] / [data-inv-download] / [data-inv-preview]. */
(function () {
  'use strict';
  var W = 1080, P = 44, F = 'Cairo, "Segoe UI", Tahoma, Arial, sans-serif';
  var split = function (v) {
    if (v === '' || v === null || v === undefined) return ['', ''];
    var t = Math.round(Number(v) * 1000), neg = t < 0, a = Math.abs(t);
    return [(neg ? '-' : '') + Math.floor(a / 1000).toLocaleString('en-US'), String(a % 1000).padStart(3, '0')];
  };
  var money = function (v) { return (Math.round(Number(v) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' د.ل'; };

  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '…'; }
    return lines;
  }
  function rrect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke(); }
  }
  function text(ctx, s, x, y, o) {
    o = o || {}; ctx.font = (o.w || 700) + ' ' + (o.size || 26) + 'px ' + F; ctx.fillStyle = o.color || '#111';
    ctx.textAlign = o.align || 'right'; ctx.textBaseline = o.base || 'middle'; ctx.direction = o.dir || 'rtl';
    ctx.fillText(s, x, y);
  }

  function draw(d) {
    // columns from the right (RTL): م | البيان | الكمية | سعر الوحدة (دينار، درهم) | الإجمالي (دينار، درهم)
    var gap = 6, inner = W - 2 * P;
    var cw = [58, 0, 96, 118, 78, 128, 82]; cw[1] = inner - cw.reduce(function (a, b) { return a + b; }, 0) - gap * 6;
    var xs = []; var x = W - P; for (var i = 0; i < cw.length; i++) { xs.push(x); x -= cw[i] + gap; } // right edge of each column
    var tmp = document.createElement('canvas').getContext('2d'); tmp.font = '700 25px ' + F; tmp.direction = 'rtl';
    var rows = d.rows.map(function (r) { return { r: r, lines: wrap(tmp, r.name, cw[1] - 20, 3) }; });
    var minRows = Math.max(8, rows.length);
    var rowH = function (k) { return k < rows.length ? Math.max(58, rows[k].lines.length * 32 + 20) : 50; };
    var tableH = 0; for (var k = 0; k < minRows; k++) tableH += rowH(k);
    var H = 470 + 96 + tableH + 330;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    // header
    text(ctx, d.title, W - P, 70, { size: 72, w: 900 });
    text(ctx, d.subtitle || '', W - P, 140, { size: 28, w: 800 });
    text(ctx, d.tagline || '', W - P - 150, 182, { size: 28, w: 800 });
    (d.brands || []).forEach(function (b, i) { text(ctx, b, P, 62 + i * 44, { size: i ? 32 : 46, w: 900, align: 'left', dir: 'ltr' }); });
    text(ctx, d.address || '', W - P, 250, { size: 28, w: 800 });
    // invoice no + cash/credit
    text(ctx, 'فاتورة رقم', 650, 236, { size: 22, w: 800 });
    text(ctx, 'INVOICE', 650, 264, { size: 20, w: 800, dir: 'ltr' });
    text(ctx, d.number, 530, 252, { size: 34, w: 700, color: '#d0021b', dir: 'ltr' });
    var box = function (bx, on, label) {
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.strokeRect(bx, 238, 28, 28);
      if (on) { ctx.beginPath(); ctx.moveTo(bx + 5, 252); ctx.lineTo(bx + 12, 261); ctx.lineTo(bx + 24, 243); ctx.stroke(); }
      text(ctx, label, bx - 8, 252, { size: 27, w: 800 });
    };
    box(225, !d.credit, 'نقداً'); box(85, d.credit, 'أجل');
    // customer + date
    var y = 300;
    rrect(ctx, W - P - 120, y, 120, 58, 10, null, '#111'); text(ctx, 'الزبون', W - P - 60, y + 30, { size: 26, w: 800, align: 'center' });
    rrect(ctx, 330, y, W - P - 120 - 12 - 330, 58, 10, null, '#111');
    text(ctx, d.customer || '', W - P - 140, y + 30, { size: 26, w: 800 });
    text(ctx, d.phone || '', 350, y + 30, { size: 25, w: 700, align: 'left', dir: 'ltr', color: '#333' });
    text(ctx, 'التاريخ', 316, y + 30, { size: 26, w: 800 });
    rrect(ctx, P, y, 180, 58, 10, null, '#111'); text(ctx, d.date || '', P + 90, y + 30, { size: 25, w: 700, align: 'center', dir: 'ltr' });

    // table header
    y = 390; var hh = 92;
    var head = function (ci, span, label, two) {
      var right = xs[ci], left = xs[ci + span - 1] - cw[ci + span - 1], w = right - left;
      rrect(ctx, left, y, w, two ? 50 : hh, 12, '#111');
      text(ctx, label, left + w / 2, y + (two ? 26 : hh / 2), { size: 25, w: 800, color: '#fff', align: 'center' });
      if (two) for (var j = 0; j < span; j++) {
        var cr = xs[ci + j], cl = cr - cw[ci + j];
        ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.strokeRect(cl, y + 50, cw[ci + j], hh - 50);
        text(ctx, j ? 'درهم' : 'دينار', cl + cw[ci + j] / 2, y + 71, { size: 20, w: 800, align: 'center' });
      }
    };
    head(0, 1, 'م'); head(1, 1, 'البيــــان'); head(2, 1, 'الكمية'); head(3, 2, 'سعر الوحدة', true); head(5, 2, 'السعر الإجمالي', true);
    // rows
    y += hh + 4; var top = y;
    for (k = 0; k < minRows; k++) {
      var h = rowH(k), row = rows[k];
      ctx.strokeStyle = '#9aa3ae'; ctx.lineWidth = 1.2;
      for (i = 0; i < cw.length; i++) { ctx.beginPath(); ctx.moveTo(xs[i] - cw[i], y + h); ctx.lineTo(xs[i], y + h); ctx.stroke(); }
      text(ctx, String(k + 1), xs[0] - cw[0] / 2, y + h / 2, { size: 24, w: 800, align: 'center' });
      if (row) {
        row.lines.forEach(function (ln, li) { text(ctx, ln, xs[1] - 10, y + h / 2 + (li - (row.lines.length - 1) / 2) * 32, { size: 25, w: 700 }); });
        text(ctx, String(row.r.qty), xs[2] - cw[2] / 2, y + h / 2, { size: 26, w: 800, align: 'center', dir: 'ltr' });
        var u = split(row.r.unit), t = split(row.r.total);
        text(ctx, u[0], xs[3] - cw[3] / 2, y + h / 2, { size: 26, w: 800, align: 'center', dir: 'ltr' });
        text(ctx, u[1], xs[4] - cw[4] / 2, y + h / 2, { size: 22, w: 700, align: 'center', dir: 'ltr', color: '#555' });
        text(ctx, t[0], xs[5] - cw[5] / 2, y + h / 2, { size: 26, w: 800, align: 'center', dir: 'ltr' });
        text(ctx, t[1], xs[6] - cw[6] / 2, y + h / 2, { size: 22, w: 700, align: 'center', dir: 'ltr', color: '#555' });
      }
      y += h;
    }
    for (i = 0; i < cw.length; i++) rrect(ctx, xs[i] - cw[i], top - 4, cw[i], y - top + 4, 10, null, '#111');

    // totals + words
    y += 26;
    var tl = P, tw = 360;
    [['المجموع', d.total], ['المدفوع', d.paid], ['البـاقـي', d.remaining]].forEach(function (r, j) {
      var yy = y + j * 70;
      text(ctx, r[0], tl + tw + 120, yy + 29, { size: 28, w: 900 });
      rrect(ctx, tl, yy, tw, 58, 10, null, '#111');
      text(ctx, money(r[1]), tl + tw - 16, yy + 30, { size: 28, w: 800, align: 'right', dir: 'ltr' });
    });
    var wl = tl + tw + 150, ww = W - P - wl;
    rrect(ctx, wl, y, ww, 50, 10, null, '#111'); text(ctx, 'المبلغ بالحروف', W - P - 16, y + 26, { size: 25, w: 800 });
    ctx.font = '700 25px ' + F; var wl2 = wrap(ctx, d.words || '', ww - 30, 3);
    rrect(ctx, wl, y + 60, ww, Math.max(80, wl2.length * 36 + 24), 10, null, '#111');
    wl2.forEach(function (ln, j) { text(ctx, ln, W - P - 16, y + 60 + 30 + j * 36, { size: 25, w: 700 }); });

    // footer
    y += 240;
    (d.phones || []).forEach(function (p, j) {
      text(ctx, (p[0] || '') + ' :', W - P, y + j * 42, { size: 25, w: 800 });
      text(ctx, p[1], W - P - 120, y + j * 42, { size: 28, w: 800, dir: 'ltr' });
    });
    text(ctx, 'التوقيع والختم', P + 150, y, { size: 26, w: 800, align: 'center' });
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P, y + 50); ctx.lineTo(P + 300, y + 50); ctx.stroke();
    text(ctx, 'طريقة الدفع: ' + (d.payment || '') + (d.pickup ? ' · ' + d.pickup : ''), W - P, H - 26, { size: 20, w: 600, color: '#5b6573' });
    return c;
  }

  function toBlob(c) { return new Promise(function (res) { c.toBlob(res, 'image/png'); }); }

  window.KAInvoice = {
    draw: draw,
    attach: function (el) {
      if (!el) return;
      var d = JSON.parse(el.dataset.json); var ready = null; var fileName = 'فاتورة-' + d.number + '.png';
      var build = function () {
        if (!ready) ready = (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('900 40px Cairo'), document.fonts.load('700 26px Cairo')]).catch(function () {}) : Promise.resolve())
          .then(function () { var c = draw(d); return toBlob(c).then(function (b) { return { canvas: c, blob: b }; }); });
        return ready;
      };
      build().then(function (r) {
        document.querySelectorAll('[data-inv-preview]').forEach(function (img) { img.src = URL.createObjectURL(r.blob); img.hidden = false; });
      });
      var download = function (blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); };
      document.addEventListener('click', function (e) {
        var sh = e.target.closest('[data-inv-share]'), dl = e.target.closest('[data-inv-download]');
        if (!sh && !dl) return;
        e.preventDefault();
        build().then(function (r) {
          if (dl) return download(r.blob);
          var file = new File([r.blob], fileName, { type: 'image/png' });
          var text = 'فاتورة رقم ' + d.number + ' — ' + d.customer + ' — الإجمالي ' + money(d.total);
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], text: text, title: 'فاتورة ' + d.number }).catch(function () {});
          } else {
            // desktop / older phones: save the picture, then open WhatsApp so it can be attached
            download(r.blob);
            var n = (el.dataset.wa || '').split(',')[0];
            if (n) { if (n.charAt(0) === '0') n = '218' + n.slice(1); window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(text + '\n(صورة الفاتورة محفوظة على جهازك، أرفقها هنا)'), '_blank', 'noopener'); }
          }
        });
      });
    },
  };
  document.addEventListener('DOMContentLoaded', function () { window.KAInvoice.attach(document.getElementById('inv-data')); });
})();
