// Usage: node tests/shots.js <baseUrl> <outDir> <path1> [path2...]
const { chromium } = require('playwright');
(async () => {
  const [base, out, ...paths] = process.argv.slice(2);
  const b = await chromium.launch();
  for (const [name, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1366, height: 900 }]]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(String(e)));
    for (const path of paths) {
      await p.goto(base + path, { waitUntil: 'networkidle' });
      await p.waitForTimeout(400);
      const f = `${out}/${name}_${path.replace(/[^a-z0-9]+/gi, '_') || 'home'}.png`;
      await p.screenshot({ path: f, fullPage: true });
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      console.log(f, 'scrollWidth', w, errs.splice(0).join(' | '));
    }
    await ctx.close();
  }
  await b.close();
})();
