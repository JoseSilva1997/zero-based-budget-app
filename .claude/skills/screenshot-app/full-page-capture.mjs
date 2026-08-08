/* ============================================================
   Native full-page screenshot for the House Budget Electron app.

   Playwright's page.screenshot({ fullPage: true }) grows the viewport to
   document.documentElement's scroll size before shooting. That works for an
   ordinary web page, but this app's scrolling happens inside .main
   (overflow-y: auto in app.css) - the document itself never overflows, so
   Playwright sees no extra height and silently returns the same image as a
   plain viewport shot. (Confirmed: scrolling .main and reshooting with
   fullPage:true produced byte-identical dimensions to the top-of-page shot.)

   The fix is the approach below, run inside the real Electron main process
   via ElectronApplication#evaluate: measure how much of .main is hidden by
   its own scrollbar, grow the actual OS window by exactly that much so the
   whole page lays out with nothing left to scroll, take one native
   BrowserWindow#capturePage() of it, then put the window back. One real
   paint, no stitching, no document-scroll assumption.
   ============================================================ */

/**
 * @param {import('playwright-core').ElectronApplication} app
 * @param {import('playwright-core').Page} page
 * @param {string} [selector] CSS selector of the app's scrollable region
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function captureFullPage(app, page, selector = '.main') {
  const winHandle = await app.browserWindow(page);

  // `selector` must travel inside the evaluate() arg, not as a closure - the
  // function below is serialised and re-run in the Electron main process,
  // a separate process that never had this module's outer scope to close over.
  const pngBase64 = await app.evaluate(async ({ }, { win, selector }) => {
    const measureJs = `({
      clientWidth: (document.querySelector(${JSON.stringify(selector)}) || document.documentElement).clientWidth,
      clientHeight: (document.querySelector(${JSON.stringify(selector)}) || document.documentElement).clientHeight,
      scrollWidth: (document.querySelector(${JSON.stringify(selector)}) || document.documentElement).scrollWidth,
      scrollHeight: (document.querySelector(${JSON.stringify(selector)}) || document.documentElement).scrollHeight,
    })`;

    const before = await win.webContents.executeJavaScript(measureJs);
    const [origWidth, origHeight] = win.getSize();
    const extraW = Math.max(0, before.scrollWidth - before.clientWidth);
    const extraH = Math.max(0, before.scrollHeight - before.clientHeight);

    if (extraW || extraH) {
      win.setSize(origWidth + extraW, origHeight + extraH);
      // Let the new size actually reflow before capturing - one rAF for the
      // resize to land, a second for layout/paint to settle on top of it.
      await win.webContents.executeJavaScript(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
      );
    }

    const image = await win.webContents.capturePage();
    const png = image.toPNG().toString('base64');

    if (extraW || extraH) win.setSize(origWidth, origHeight);
    return png;
  }, { win: winHandle, selector });

  return Buffer.from(pngBase64, 'base64');
}
