/**
 * 用 playwright-core 驱动本机 Edge，真实验证「点播能不能播」——不依赖虚拟时钟。
 * 用法：node ../scripts/probe-play.mjs [url]
 */
import { chromium } from '../秒记卡/node_modules/playwright-core/index.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:8787/';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });

const start = Date.now();
const result = await page
  .waitForFunction(
    () => {
      const video = document.querySelector('video');
      if (!video) return false;
      if (video.readyState >= 1) return { ok: true, duration: video.duration, w: video.videoWidth };
      const err = document.querySelector('.player-status[role="alert"]');
      if (err) return { ok: false, text: err.textContent?.slice(0, 160) };
      return false;
    },
    { timeout: 45_000, polling: 500 },
  )
  .then(async (handle) => {
    const value = await handle.jsonValue();
    return { ...value, ms: Date.now() - start };
  })
  .catch((error) => ({ ok: false, text: error.message.slice(0, 160), ms: Date.now() - start }));

console.log('RESULT', JSON.stringify(result));

const title = await page.evaluate(() => {
  const el = document.querySelector('.video-switcher, .screen-card__bar');
  const playing = document.querySelector('video');
  return {
    bar: el?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '',
    videoSrc: playing?.getAttribute('src')?.slice(0, 90) ?? '(no video)',
    readyState: playing?.readyState ?? -1,
  };
});
console.log('PAGE', JSON.stringify(title));

await page.screenshot({ path: process.env.SHOT || 'tmp/play-check.png' });
await browser.close();

if (consoleLines.length) {
  console.log('CONSOLE');
  for (const line of consoleLines.slice(-12)) console.log(' ', line);
}
process.exit(result.ok ? 0 : 1);
