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

/* Seeded random generator for reproducible property tests. */
function seededRandom(seed) {
  let state = seed;
  return function() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

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
  check('over-allocated emits a beyond region', ro.some((x) => x.key === 'beyond'), JSON.stringify(ro));
  check('over-allocated has no gap', !ro.some((x) => x.key === 'gap'), JSON.stringify(ro));

  // Zero-width regions are never emitted.
  check('no zero-width regions', barRegions(mid).every((x) => x.to - x.from > 0));

  /* Negative and NaN inputs: clamping and the finite guard. */
  const neg = barGeometry(-10, -5, 100);
  check('negative income is clamped to zero', near(neg.incomeX, 0));
  check('negative allocated is clamped to zero', near(neg.allocX, 0));
  check('negative input does not produce empty geometry', neg.empty === false);

  const nanTest = barGeometry(NaN, 100, 50);
  check('NaN input treated as empty', nanTest.empty === true);
  check('NaN empty has zero scale', nanTest.scale === 0);
  check('NaN returns empty regions', barRegions(nanTest).length === 0);

  /* --- The three pinned cases. Each one nails down a distinction a previous
     round got wrong: a flag rewritten in terms of a capped region value
     instead of the plan's own quantities. --- */

  // income 4200, allocated 4500, actual 4600: both breaches are real, and
  // overspent must read true even though the spending spills past income
  // and gets folded into the beyond region.
  const case1 = barGeometry(4200, 4500, 4600);
  check('case 1: over-allocated', case1.overAllocated === true);
  check('case 1: overspent', case1.overspent === true);

  // income 4200, allocated 3400, actual 4500: the allocation never exceeded
  // income, so overAllocated must stay false even though spending pushes a
  // beyond region onto the track. overspent is true regardless.
  const case2 = barGeometry(4200, 3400, 4500);
  check('case 2: not over-allocated', case2.overAllocated === false);
  check('case 2: overspent', case2.overspent === true);
  check('case 2: has a beyond region', barRegions(case2).some((x) => x.key === 'beyond'), JSON.stringify(barRegions(case2)));

  // income 100, allocated 100.001, actual 0: a tenth of a penny is under the
  // half-penny tolerance, so neither the flag nor a beyond region should fire.
  const case3 = barGeometry(100, 100.001, 0);
  check('case 3: not over-allocated (under tolerance)', case3.overAllocated === false);
  check('case 3: no beyond region painted', !barRegions(case3).some((x) => x.key === 'beyond'), JSON.stringify(barRegions(case3)));

  /* Property tests on pseudo-random triples using a seeded generator.
     These cover edge cases, epsilon boundaries, and exhaustive combinations
     that the specific test cases above cannot reach. */
  const rng = seededRandom(12345);
  const PROP_TESTS = 5000;
  let passedProps = 0;

  for (let i = 0; i < PROP_TESTS; i++) {
    /* Generate triples: mix of small values, zeros, ties, epsilon edges, and large values. */
    const scale = rng() * 10000;
    let income = rng() * scale;
    let allocated = rng() * scale;
    let actual = rng() * scale;

    /* Bias toward interesting cases: zeros, exact matches, and epsilon crossings. */
    if (rng() < 0.1) income = 0;
    if (rng() < 0.1) allocated = 0;
    if (rng() < 0.1) actual = 0;
    if (rng() < 0.05) { allocated = income; }
    if (rng() < 0.05) { actual = allocated; }
    if (rng() < 0.05) { allocated = income + 0.003; } /* just under epsilon */
    if (rng() < 0.05) { allocated = income + 0.007; } /* just over epsilon */

    const g = barGeometry(income, allocated, actual);
    const regions = barRegions(g);

    if (g.empty) {
      if (regions.length !== 0) {
        check(`prop ${i}: empty geometry has no regions`, false, `got ${regions.length} regions`);
        continue;
      }
      passedProps++;
      continue;
    }

    /* The clamped money values the flags must answer to directly: not the
       fractions, not the regions, just the plan's own quantities. This is
       the property the suite was missing. The old suite only ever checked a
       flag against a region built from the same formula as the flag, which
       cannot catch a flag that is wrong in the first place. */
    const inc = Math.max(income, 0);
    const alloc = Math.max(allocated, 0);
    const spentV = Math.max(actual, 0);
    const expectedOverAllocated = alloc > inc + 0.005;
    const expectedOverspent = spentV > alloc + 0.005;
    if (g.overAllocated !== expectedOverAllocated) {
      check(`prop ${i}: overAllocated disagrees with clamped money`, false,
        `flag=${g.overAllocated}, expected=${expectedOverAllocated} (inc=${inc}, alloc=${alloc})`);
      continue;
    }
    if (g.overspent !== expectedOverspent) {
      check(`prop ${i}: overspent disagrees with clamped money`, false,
        `flag=${g.overspent}, expected=${expectedOverspent} (alloc=${alloc}, spent=${spentV})`);
      continue;
    }

    /* Check region list properties: ordered, within bounds, no zero-width. */
    let regionsPassed = true;
    for (let j = 0; j < regions.length; j++) {
      const r = regions[j];
      if (r.to - r.from <= 0) {
        check(`prop ${i}: zero-width region ${r.key}`, false);
        regionsPassed = false;
        break;
      }
      if (r.from < 0 || r.to > 1 || !Number.isFinite(r.from) || !Number.isFinite(r.to)) {
        check(`prop ${i}: region ${r.key} out of bounds [${r.from}, ${r.to}]`, false);
        regionsPassed = false;
        break;
      }
      /* Thin spans are dropped at epsX now, not at an exact zero, so
         contiguity only needs to hold to that same tolerance. */
      if (j > 0 && Math.abs(regions[j - 1].to - r.from) > g.epsX) {
        check(`prop ${i}: regions not contiguous between ${regions[j - 1].key} and ${r.key}`, false,
          `${regions[j - 1].to} vs ${r.from}`);
        regionsPassed = false;
        break;
      }
    }
    if (!regionsPassed) continue;

    /* Final coverage, likewise relaxed to epsX: a dropped sliver at the very
       end can leave the last region short of the true maximum by up to one
       tolerance. */
    const finalBound = Math.max(g.allocX, g.spentX, g.incomeX);
    if (regions.length > 0 && Math.abs(regions[regions.length - 1].to - finalBound) > g.epsX) {
      check(`prop ${i}: final region does not reach max(alloc, spent, income)`, false,
        `${regions[regions.length - 1].to} vs ${finalBound}`);
      continue;
    }

    /* Flags and regions are related by implication, not equivalence, and
       only in one direction. A flag can be true while its span is absent,
       because past the income mark an overspend or an over-allocation is
       subsumed into the beyond region.

       overAllocated implies a beyond region exists, unconditionally: if the
       allocation exceeds income, some part of it always sits past the mark.

       overspent implies an overspent region exists only when the spending
       itself stayed within income; once spending crosses the income mark
       the excess is beyond's to paint, not overspent's, so the implication
       is guarded by spentX <= incomeX. */
    const hasOverspent = regions.some((r) => r.key === 'overspent');
    if (g.overspent && g.spentX <= g.incomeX && !hasOverspent) {
      check(`prop ${i}: overspent true (spending within income) but no overspent region`, false,
        `spentX=${g.spentX}, incomeX=${g.incomeX}`);
      continue;
    }

    const hasBeyond = regions.some((r) => r.key === 'beyond');
    if (g.overAllocated && !hasBeyond) {
      check(`prop ${i}: overAllocated flag true but no beyond region`, false,
        `flag=${g.overAllocated}, beyond=${hasBeyond}`);
      continue;
    }

    passedProps++;
  }
  check(`property tests: ${passedProps}/${PROP_TESTS} passed`, passedProps === PROP_TESTS,
    `${PROP_TESTS - passedProps} property tests failed`);

  const failed = results.filter((x) => !x.ok);
  for (const f of failed) console.error(`FAIL  ${f.name}${f.msg ? ': ' + f.msg : ''}`);
  console.log(`${results.length - failed.length}/${results.length} bar geometry checks passed`);
  app.exit(failed.length === 0 ? 0 : 1);
});
