/* ============================================================
   Month bar geometry.

   The bar's scale is max(income, allocated, actual), so the income point
   becomes an interior rule when the month overshoots. These tests pin the
   fractions and the region list for every state the bar can be in.

   Run with:  npx electron tests/bar-electron.cjs
   ============================================================ */
const { app } = require('electron');
const esbuild = require('esbuild');
const path = require('path');

app.disableHardwareAcceleration();
const root = path.join(__dirname, '..');

const results = [];
function check(name, cond, msg) { results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') }); }
const near = (a, b) => Math.abs(a - b) < 1e-6;

app.whenReady().then(async () => {
  const built = await esbuild.build({
    entryPoints: [path.join(root, 'renderer', 'lib', 'bar.js')],
    bundle: true, format: 'cjs', write: false, platform: 'node',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', built.outputFiles[0].text)(mod, mod.exports);
  const { barGeometry, barRegions } = mod.exports;

  // Nothing at all: no income, no allocation. There is nothing to nag about.
  const none = barGeometry(0, 0, 0);
  check('empty when there is no money', none.empty === true);
  check('empty has zero scale', none.scale === 0);

  // Income only. The track is entirely gap.
  const fresh = barGeometry(4200, 0, 0);
  check('fresh is not empty', fresh.empty === false);
  check('fresh income fills the track', near(fresh.incomeX, 1));
  check('fresh has no fill', near(fresh.allocX, 0) && near(fresh.spentX, 0));
  check('fresh is not over-allocated', fresh.overAllocated === false);

  // Part-way through a normal month.
  const mid = barGeometry(4200, 3400, 2150);
  check('mid scale is income', mid.scale === 4200);
  check('mid alloc fraction', near(mid.allocX, 3400 / 4200));
  check('mid spent fraction', near(mid.spentX, 2150 / 4200));
  check('mid has no breaches', mid.overAllocated === false && mid.overspent === false);

  // Exactly zero. This is the success state and must NOT read as a breach.
  const settled = barGeometry(4200, 4200, 0);
  check('settled fills the track', near(settled.allocX, 1));
  check('settled is not over-allocated', settled.overAllocated === false);
  check('settled has no gap region', !barRegions(settled).some((r) => r.key === 'gap'));

  // Over-allocated: the scale grows and the income mark moves inside.
  const over = barGeometry(4200, 4510, 0);
  check('over-allocated rescales', over.scale === 4510);
  check('over-allocated moves the income mark inside', near(over.incomeX, 4200 / 4510));
  check('over-allocated flag', over.overAllocated === true);

  // Overspent: solid breaks past faded, scale still income.
  const spent = barGeometry(4200, 3400, 3580);
  check('overspent keeps income scale', spent.scale === 4200);
  check('overspent flag', spent.overspent === true);

  // Allocated but no income at all: the whole fill is a breach, which is true.
  const noIncome = barGeometry(0, 500, 0);
  check('no income rescales to allocated', noIncome.scale === 500);
  check('no income puts the mark at zero', near(noIncome.incomeX, 0));
  check('no income is over-allocated', noIncome.overAllocated === true);

  // Spending past income rescales everything.
  const wild = barGeometry(4200, 3400, 4600);
  check('spending past income rescales', wild.scale === 4600);

  // Regions, mid-month: spent, then the rest of the allocation, then the gap.
  const r = barRegions(mid);
  check('mid has three regions', r.length === 3, JSON.stringify(r));
  check('mid region order', r.map((x) => x.key).join(',') === 'spent,allocated,gap', JSON.stringify(r));
  check('mid regions are contiguous', near(r[0].to, r[1].from) && near(r[1].to, r[2].from));
  check('mid last region ends at the income mark', near(r[2].to, mid.incomeX));

  // Regions, overspent: the overspent slice sits between spent and the gap.
  const rs = barRegions(spent);
  check('overspent emits an overspent region', rs.some((x) => x.key === 'overspent'), JSON.stringify(rs));
  check('overspent region starts at the allocation edge',
    near(rs.find((x) => x.key === 'overspent').from, spent.allocX));

  // Regions, over-allocated: a breach slice past the income mark, and no gap.
  const ro = barRegions(over);
  check('over-allocated emits an overAllocated region', ro.some((x) => x.key === 'overAllocated'), JSON.stringify(ro));
  check('over-allocated has no gap', !ro.some((x) => x.key === 'gap'), JSON.stringify(ro));

  // Zero-width regions are never emitted.
  check('no zero-width regions', barRegions(mid).every((x) => x.to - x.from > 0));

  const failed = results.filter((x) => !x.ok);
  for (const f of failed) console.error(`FAIL  ${f.name}${f.msg ? ': ' + f.msg : ''}`);
  console.log(`${results.length - failed.length}/${results.length} bar geometry checks passed`);
  app.exit(failed.length === 0 ? 0 : 1);
});
