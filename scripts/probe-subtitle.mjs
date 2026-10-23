/**
 * 验证「点播 + 智能字幕」：把视频跳到第 30 秒，看「正在听到」有没有跟着字幕走，
 * 并顺带点一次「记一下」，确认卡片能落库。
 * 用法：node scripts/probe-subtitle.mjs
 */
import { chromium } from '../秒记卡/node_modules/playwright-core/index.mjs';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });

await page.waitForFunction(() => {
  const video = document.querySelector('video');
  return Boolean(video && video.readyState >= 1);
}, { timeout: 45_000 });

const seekTo = 30;
await page.evaluate((t) => {
  const video = document.querySelector('video');
  if (video) {
    video.currentTime = t;
    video.dispatchEvent(new Event('timeupdate'));
  }
}, seekTo);
await page.waitForTimeout(1500);

const state = await page.evaluate(() => {
  const video = document.querySelector('video');
  const now = [...document.querySelectorAll('.now-reading p')].map((el) => el.textContent?.trim());
  const subtitleChip = document.querySelector('.subtitle-note')?.textContent?.trim();
  return { currentTime: video?.currentTime, now, subtitleChip };
});
console.log('SEEK', JSON.stringify(state));

// 点一次「记一下」，看看抓到的字幕与时间
await page.click('.capture-button');
await page.waitForTimeout(800);
const composer = await page.evaluate(() => {
  const quote = document.querySelector('.composer__quote')?.textContent?.trim();
  const pill = document.querySelector('.time-pill')?.textContent?.trim();
  const summary = document.querySelector('#note-summary')?.value;
  return { pill, quote, summary };
});
console.log('CAPTURE', JSON.stringify(composer));

await page.screenshot({ path: process.env.SHOT || 'tmp/subtitle-check.png' });
await browser.close();
