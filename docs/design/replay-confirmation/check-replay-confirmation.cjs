const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Users/79412/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 820 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'replay-confirmation-preview.html')).href);
    const frame = page.frameLocator('iframe');
    await frame.locator('[data-design="simple"]').waitFor();
    assert.equal(await frame.locator('[data-design="simple"] .rp-details').getAttribute('open'), null);
    await frame.locator('[data-design="simple"] summary').click();
    assert.notEqual(await frame.locator('[data-design="simple"] .rp-details').getAttribute('open'), null);
    await frame.locator('[data-design="simple"] summary').click();
    await frame.locator('[data-design="simple"]').screenshot({ path: path.join(__dirname, 'replay-confirmation-simple.png') });
    const buttons = await frame.locator('.viz-carousel button').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, label: n.getAttribute('aria-label') })));
    console.log('carousel buttons', JSON.stringify(buttons));
    await frame.getByRole('button', { name: '下一方案', exact: true }).click();
    await frame.locator('[data-design="file"]').waitFor();
    await frame.getByRole('button', { name: '重命名', exact: true }).click();
    await frame.getByRole('textbox', { name: '修改回放文件名' }).fill('我的直播回放');
    await frame.getByRole('button', { name: '完成', exact: true }).click();
    assert.equal(await frame.locator('[data-display-name]').textContent(), '我的直播回放.ts');
    await frame.locator('[data-design="file"]').screenshot({ path: path.join(__dirname, 'replay-confirmation-file.png') });
    for (const width of [760, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await frame.locator('[data-design="file"]').evaluate(el => ({
        width: el.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth,
        bold: [...el.querySelectorAll('dd,input,.rp-file-name')].some(n => parseInt(getComputedStyle(n).fontWeight) > 500)
      }));
      assert.equal(bounds.overflow, false); assert.equal(bounds.bold, false);
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await frame.locator('[data-design="file"]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(32, 35, 43)');
    await frame.locator('#replay-confirmation-review').evaluate(() => {
      window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: {
        privateContent: { designs: { file: { state: '普通回放', qualityKnown: true, headingWeight: '常规' } } }
      } } } }));
    });
    assert.equal(await frame.locator('[data-design="file"] [data-notice]').isVisible(), false);
    assert.equal(await frame.locator('[data-design="file"] [data-quality]').isVisible(), true);
    assert.equal(await frame.locator('[data-display-name]').textContent(), '我的直播回放.mp4');
    await frame.locator('#replay-confirmation-review').evaluate(() => {
      window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: {
        privateContent: { designs: { file: { state: '大小未知', qualityKnown: false } } }
      } } } }));
    });
    assert.equal(await frame.locator('[data-design="file"] [data-size]').textContent(), '暂无法估算');
    assert.equal(await frame.locator('[data-design="file"] [data-quality]').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('通过：方案切换、技术详情展开、文件重命名、窄屏布局与深色主题；无脚本错误。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
