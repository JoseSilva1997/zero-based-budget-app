/* ============================================================
   Collapsible sidebar test.

   Three things have to hold for the rail to work, and they live in three
   different places, so each is checked where it actually is:

     1. app_meta round trip - 'sidebarCollapsed' survives a write and comes
        back off loadBootstrap as a boolean, with absent meaning expanded.
     2. app.css in a real window - the 64px column, the hidden labels, the
        :has() update dot, and the one piece of cascade this feature leans on:
        the rail width is declared on .app so it beats the narrow-window
        --sidebar-w that the breakpoints declare on :root.
     3. main.jsx markup - the collapse hides label text, so every nav item
        has to carry its name somewhere the collapse cannot reach.

   Requires a prior `npm run build` (loads build/database/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     Remove-Item Env:ELECTRON_RUN_AS_NODE; npx electron tests/sidebar-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
let count = 0;

function assert(cond, msg) {
  count += 1;
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  count += 1;
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

/* The panel, reduced to the elements the rail rules actually address. Built
   from the same class names main.jsx renders; block 3 below is what keeps the
   two from drifting apart. */
const FIXTURE = `<!doctype html><html><body>
  <div class="app" id="shell">
    <aside class="sidebar">
      <div class="brand">
        <button class="brand-mark"><span class="brand-mark-hb">HB</span><span class="brand-mark-chev">&lsaquo;</span></button>
        <div class="brand-text"><h1 class="brand-name">House Budget</h1><div class="brand-sub">Zero-based</div></div>
      </div>
      <nav>
        <button class="nav-item active"><span class="nav-item-label">Dashboard</span></button>
      </nav>
      <div class="sidebar-foot">
        <div class="update-banner" id="banner"></div>
        <div class="household">
          <div class="nav-label">Household</div>
          <div class="member-chip"><span class="member-chip-name">Alex</span></div>
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="main-inner">
        <!-- A Recharts plot caught mid-resize. The nesting is Recharts' own,
             copied from the running app rather than imagined, and the middle
             div matters: ResponsiveContainer sizes it to zero on purpose so
             the plot's measured width can never feed back into the width it
             is measuring. A fixture without it would let a fix pass here that
             makes every chart in the app vanish.
             ResponsiveContainer writes the measured pixel width onto
             .recharts-wrapper from a ResizeObserver callback, so while the
             column is moving the wrapper still carries the width the column
             had a frame ago. 900px in a column nowhere near that wide is
             that frame. -->
        <div class="recharts-responsive-container" id="plot-box" style="width: 100%; height: 80px; min-width: 0px">
          <div style="width: 0px; overflow-x: visible">
            <div class="recharts-wrapper" id="plot" style="position: relative; cursor: default; width: 900px; height: 80px">
              <svg width="900" height="80"></svg>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
  <!-- The loading shell draws the same tile as a plain div, outside the app
       grid entirely. It must not have picked up the button's behaviour. -->
  <div class="brand-mark" id="splash-mark">HB</div>
</body></html>`;

app.whenReady().then(async () => {
  let win = null;
  try {
    /* ---- 1. the setting survives the database ---------------------------- */
    const Database = require('better-sqlite3');
    const b = (...p) => require(path.join(root, 'build', 'database', ...p));
    const { runMigrations } = b('migrations.js');
    const { setMeta } = b('repositories', 'meta.js');
    const { loadBootstrap } = b('repositories', 'bootstrap.js');

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
    db.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
    db.pragma('user_version = 1');
    runMigrations(db);

    // No row at all: an install that has never touched the toggle.
    eq(loadBootstrap(db).settings.sidebarCollapsed, false, 'an untouched install opens expanded');
    setMeta(db, 'sidebarCollapsed', '1');
    eq(loadBootstrap(db).settings.sidebarCollapsed, true, 'a collapsed panel reopens collapsed');
    setMeta(db, 'sidebarCollapsed', '0');
    eq(loadBootstrap(db).settings.sidebarCollapsed, false, 'expanding again is persisted too');
    // The renderer sends a boolean and reads a boolean; a truthy string here
    // would put "0" on the wrong side of an if.
    eq(typeof loadBootstrap(db).settings.sidebarCollapsed, 'boolean', 'bootstrap must hand over a boolean');
    db.close();

    /* ---- 2. what the CSS does with it ------------------------------------ */
    const css = fs.readFileSync(path.join(root, 'renderer', 'app.css'), 'utf8');
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 860,
      webPreferences: { contextIsolation: false, sandbox: false },
    });
    await win.loadURL('data:text/html,' + encodeURIComponent(FIXTURE));
    await win.webContents.insertCSS(css);
    /* .app transitions grid-template-columns, and this window is hidden, so it
       produces no frames for that transition to advance on: getComputedStyle
       would report the value the column started from and never the one it is
       heading to. Switching the transition off makes each read the rule's own
       answer, which is what this block is about. The transition itself is a
       visual matter and is not what a computed style can tell you. */
    await win.webContents.insertCSS('.app { transition: none !important; }');

    const js = (expr) => win.webContents.executeJavaScript(expr);
    // Long enough for a resize to reach the renderer and re-evaluate @media.
    const settle = () => new Promise((r) => setTimeout(r, 120));
    const railOn = () => js("document.getElementById('shell').setAttribute('data-panel','rail')");
    const railOff = () => js("document.getElementById('shell').removeAttribute('data-panel')");
    const firstColumn = () =>
      js("getComputedStyle(document.getElementById('shell')).gridTemplateColumns.split(' ')[0]");
    const displayOf = (sel) => js(`getComputedStyle(document.querySelector('${sel}')).display`);
    const dot = () => js("getComputedStyle(document.querySelector('.brand-mark'),'::after').content");

    eq(await firstColumn(), '240px', 'the expanded panel is the width app.css declares');
    for (const sel of ['.brand-text', '.nav-item-label', '.member-chip-name']) {
      assert((await displayOf(sel)) !== 'none', `${sel} must be visible while the panel is expanded`);
    }

    await railOn();
    eq(await firstColumn(), '64px', 'the rail is 64px');
    for (const sel of ['.brand-text', '.nav-item-label', '.member-chip-name', '.sidebar .nav-label', '.update-banner']) {
      eq(await displayOf(sel), 'none', `${sel} must be hidden in the rail`);
    }
    // The tile itself is the control, so it is the one thing that must not go.
    assert((await displayOf('.brand-mark')) !== 'none', 'the collapse control has to survive the collapse');

    const cursorOf = (sel) => js(`getComputedStyle(document.querySelector('${sel}')).cursor`);
    eq(await cursorOf('button.brand-mark'), 'pointer', 'the tile in the panel is a control');
    assert((await cursorOf('#splash-mark')) !== 'pointer', 'the loading shell tile is decoration, not a control');

    /* the update dot. Present only while UpdateBanner is rendering something,
       and only in the rail, where the notice itself cannot be shown. */
    assert((await dot()) !== 'none', 'a rendered banner lights the dot on the tile');
    await js("document.getElementById('banner').remove()");
    eq(await dot(), 'none', 'no banner, no dot');
    await railOff();
    eq(await dot(), 'none', 'the expanded panel shows the notice itself, not a dot');

    /* The cascade this leans on: below 1200px and again below 1024px the
       breakpoints re-declare --sidebar-w on :root. The rail declares it on
       .app, and a declaration on the element beats one inherited from an
       ancestor, so the rail stays 64px at every window size. */
    win.setContentSize(900, 800);
    await settle();
    eq(await firstColumn(), '184px', 'the narrow breakpoint still narrows the expanded panel');
    await railOn();
    eq(await firstColumn(), '64px', 'the rail beats the breakpoint that narrows the panel');

    /* ---- 2b. a stale chart width must not reach the scrollbar ------------
       A chart measured in pixels always lags a column that is moving, whether
       the column is moving because the panel is collapsing or because the
       window is being dragged. .main scrolls sideways when its content
       genuinely does not fit, and one frame of a stale plot width is not that:
       unclamped it flashes a horizontal scrollbar in and out, and the reflow
       that scrollbar causes is visible as a stutter. So the plot is clamped to
       the space it has and the overflow never reaches .main.
       ------------------------------------------------------------------- */
    const mainOverflow = () =>
      js("(() => { const m = document.querySelector('.main'); return m.scrollWidth - m.clientWidth; })()");
    const plotWidth = () =>
      js("Math.round(document.getElementById('plot').getBoundingClientRect().width)");
    const boxWidth = () =>
      js("Math.round(document.getElementById('plot-box').getBoundingClientRect().width)");

    await railOff();
    eq(await mainOverflow(), 0, 'a stale plot width must not make the main column scroll sideways');
    await railOn();
    eq(await mainOverflow(), 0, 'the rail must not scroll sideways either');

    /* The other half of it, and the more important half: a plot that has been
       stopped from overflowing by being reduced to nothing is not a fix. The
       clip must leave the plot at the size Recharts gave it. */
    assert((await plotWidth()) === 900, `the plot must keep its own width, got ${await plotWidth()}px`);
    // And a settled plot - one whose measured width matches its container,
    // which is every frame except the handful this rule exists for - has to be
    // visible edge to edge, with the clip taking nothing off it.
    await js("document.getElementById('plot').style.width = document.getElementById('plot-box').getBoundingClientRect().width + 'px'");
    eq(await plotWidth(), await boxWidth(), 'a settled plot fills its container exactly');
    eq(await mainOverflow(), 0, 'a settled plot does not overflow either');
    /* Only the axis that overflows. `hidden` here would make the container a
       scroll container and clip the tooltip, which is drawn inside the plot
       and is free to stand above or below it. */
    eq(await js("getComputedStyle(document.getElementById('plot-box')).overflowX"), 'clip', 'the plot is clipped sideways');
    eq(await js("getComputedStyle(document.getElementById('plot-box')).overflowY"), 'visible', 'and left alone vertically');
    await railOff();

    /* ---- 3. the markup the rules are written against --------------------- */
    const mainJsx = fs.readFileSync(path.join(root, 'renderer', 'main.jsx'), 'utf8');
    assert(
      /data-panel=\{railed \? "rail" : undefined\}/.test(mainJsx),
      'the shell must flag the rail with data-panel="rail"'
    );
    assert(
      /const railed = state\.settings\.sidebarCollapsed/.test(mainJsx),
      'the rail state must come from the persisted setting, not local component state'
    );
    assert(
      /patch: \{ sidebarCollapsed: !railed \}/.test(mainJsx),
      'toggling must write the setting back'
    );
    /* Scoped to the panel: the loading shell renders a .brand-mark of its own
       earlier in this file, and that one is meant to stay a plain div. */
    const aside = mainJsx.slice(mainJsx.indexOf('<aside className="sidebar"'), mainJsx.indexOf('</aside>'));
    assert(aside.length > 0, 'renderer/main.jsx no longer has a .sidebar aside');
    const markAt = aside.indexOf('className="brand-mark"');
    assert(markAt > -1, 'the panel no longer renders the monogram');
    const brandMark = aside.slice(markAt);
    assert(
      aside.slice(aside.slice(0, markAt).lastIndexOf('<')).startsWith('<button'),
      'the monogram is the collapse control, so it has to be a button'
    );
    assert(/aria-expanded=\{!railed\}/.test(brandMark), 'the control must report its state');
    assert(/aria-controls="sidebar-panel"/.test(brandMark), 'the control must name what it collapses');
    // The label is hidden by CSS in the rail, so an icon with no aria-label is
    // a nav item a screen reader cannot name.
    const navItem = aside.slice(aside.indexOf('className={`nav-item'), aside.indexOf('</nav>'));
    assert(/aria-label=\{label\}/.test(navItem), 'every nav item needs an aria-label the collapse cannot hide');
    assert(/title=\{label\}/.test(navItem), 'every nav item needs a title, which is the rail hover tooltip');
    assert(/className="nav-item-label"/.test(navItem), 'the visible label needs its own element to hide');

    console.log(`SIDEBAR_OK ${count} assertions`);
    process.exitCode = 0;
  } catch (err) {
    console.error('SIDEBAR_FAIL', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    app.quit();
  }
});
