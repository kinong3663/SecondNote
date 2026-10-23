/**
 * 按《秒记卡 · 演示脚本》分镜真实录屏（给剪辑用的原始素材）
 *
 * 输出：raw/segments/01..06-*.webm —— 每一段对应脚本里的一个小节，
 * 外加 raw/segments/beats.json 记录每个动作在各自片段里的秒数。
 *
 * 关键点：
 *   - 注入一个「假光标 + 点击涟漪」，因为 Playwright 的录屏不录系统光标；
 *   - 鼠标是分步移动的（steps），停下来再点，方便剪辑时对准动作；
 *   - 每个分镜独立上下文，用 storageState 把学生端的本地笔记带过去；
 *   - 学生端点击、播放、跳转都是真实浏览器行为，教师端数据来自真实接口。
 *
 * 用法：node record.mjs            # 录全部 6 段
 *       node record.mjs 03 05      # 只录指定段
 */
import { chromium } from '../秒记卡/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

// 本机浏览器与站点地址都可以用环境变量覆盖：
//   $env:EDGE_PATH="C:\...\msedge.exe"   $env:DEMO_BASE="http://127.0.0.1:8787"
const EDGE =
  process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8787';
const OUT_DIR = path.join(process.cwd(), 'raw', 'segments');
const TMP_DIR = path.join(OUT_DIR, '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

// 时间点都挑在字幕内容像样的地方（真实 ASR 字幕，不是演示文本）
const T1 = 1950.32; //  32'30" 「然后调我们的宽度和高度是1080×1920」→ 没听懂
const T2 = 3554.36; //  59'14" 「按键盘上的 G 沿着白色的边缘给它抠出来」→ 要照做
const T3 = 8029.66; // 133'49" 「跟你说磨皮不要开这么多」→ 有疑问

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 假光标：跟随 mousemove，点击时画涟漪。录屏里看得见鼠标在哪。 */
function cursorOverlay() {
  const mount = () => {
    if (document.getElementById('__demo_cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__demo_cursor{position:fixed;left:-100px;top:-100px;width:28px;height:28px;z-index:2147483600;
        pointer-events:none;will-change:transform;filter:drop-shadow(0 3px 6px rgba(6,10,20,.45))}
      #__demo_cursor svg{display:block}
      .__demo_ripple{position:fixed;width:14px;height:14px;border-radius:50%;z-index:2147483599;pointer-events:none;
        margin:-7px 0 0 -7px;background:rgba(36,105,243,.28);border:2px solid rgba(36,105,243,.85)}
    `;
    document.documentElement.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = '__demo_cursor';
    cursor.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4.2 2.4 19.4 11l-6.2 1.5-2.3 6.3z" fill="#fff" stroke="#0b1b33" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);

    let px = -100;
    let py = -100;
    const place = () => {
      cursor.style.transform = `translate(${px - 4}px, ${py - 2}px)`;
    };

    window.addEventListener(
      'mousemove',
      (e) => {
        px = e.clientX;
        py = e.clientY;
        place();
      },
      true,
    );

    window.addEventListener(
      'mousedown',
      (e) => {
        const dot = document.createElement('div');
        dot.className = '__demo_ripple';
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
        document.documentElement.appendChild(dot);
        const anim = dot.animate(
          [
            { transform: 'scale(1)', opacity: 0.95 },
            { transform: 'scale(3.6)', opacity: 0 },
          ],
          { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        anim.onfinish = () => dot.remove();
      },
      true,
    );
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});
const STATE_FILE = path.join(OUT_DIR, 'storage-state.json');
const results = [];
let storageState;
if (fs.existsSync(STATE_FILE)) {
  storageState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  console.log('· 复用上一轮的学生端本地状态（秒记卡还在）');
}

const pick = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));

async function withPage(index, name, fn) {
  const dir = path.join(TMP_DIR, String(index));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
    ...(storageState ? { storageState } : {}),
  });
  context.on('close', () => {});
  await context.addInitScript(cursorOverlay);

  const page = await context.newPage();
  const t0 = Date.now();
  const marks = [];
  const mark = (label) => marks.push({ name: label, t: Number(((Date.now() - t0) / 1000).toFixed(2)) });

  const helpers = {
    mark,
    /** 鼠标分步移到元素中心，停一下再点 */
    async hover(selector) {
      const loc = page.locator(selector).first();
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const box = await loc.boundingBox();
      if (!box) throw new Error(`找不到可点的元素: ${selector}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
      await sleep(320);
      return box;
    },
    async click(selector, settle = 700) {
      await helpers.hover(selector);
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      await sleep(settle);
    },
    async waitVideo() {
      await page.waitForFunction(
        () => {
          const v = document.querySelector('video');
          return Boolean(v && v.readyState >= 1);
        },
        { timeout: 90_000 },
      );
    },
    async seek(seconds, hold = 1500) {
      await page.evaluate((t) => {
        const v = document.querySelector('video');
        if (!v) return;
        v.currentTime = t;
        v.dispatchEvent(new Event('timeupdate'));
      }, seconds);
      await sleep(hold);
    },
    /** 让视频真的在播（而不是停在 seek 的那一秒） */
    async play() {
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v && v.paused) v.play().catch(() => {});
      });
      await sleep(1200);
      const state = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { paused: v.paused, t: Number(v.currentTime.toFixed(1)) } : null;
      });
      console.log(`  播放状态: ${state ? JSON.stringify(state) : 'no video'}`);
      return state;
    },
    /** 在摘要框里改一句自己的话（演示「自动摘录 · 可编辑」） */
    async rewrite(text, perChar = 55) {
      await helpers.click('#note-summary', 300);
      await page.keyboard.press('Control+A');
      await sleep(160);
      for (const ch of text) {
        await page.keyboard.insertText(ch);
        await sleep(perChar);
      }
      await sleep(420);
    },
    sleep,
  };

  console.log(`▶ [${index}] ${name}`);
  try {
    await fn(page, helpers);
    await sleep(400);
  } catch (error) {
    console.error(`  ✗ 失败:`, error.message);
    marks.push({ name: 'ERROR', t: Number(((Date.now() - t0) / 1000).toFixed(2)) });
    await page.screenshot({ path: path.join(OUT_DIR, `error-${index}.png`) }).catch(() => {});
  }

  const duration = Number(((Date.now() - t0) / 1000).toFixed(2));
  if (index === '01') {
    storageState = await context.storageState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(storageState), 'utf8');
  }
  const video = page.video();
  await context.close();

  const src = video ? await video.path() : null;
  if (src && fs.existsSync(src)) {
    const target = path.join(OUT_DIR, `${index}-${name}.webm`);
    fs.copyFileSync(src, target);
    results.push({ index, name, file: path.basename(target), duration, marks });
    console.log(`  ✓ ${path.basename(target)}  ${duration}s  ${(fs.statSync(target).size / 1024 / 1024).toFixed(1)}MB`);
  } else {
    console.error('  ✗ 没有拿到录屏文件');
    results.push({ index, name, file: null, duration, marks });
  }
}

const SEGMENTS = {
  '00': [
    'broll-student',
    async (page, h) => {
      // 开场空镜：开着视频、鼠标轻轻挪，不点任何东西 —— 配开场的三个痛点旁白
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await h.waitVideo();
      await h.play();
      await h.sleep(2000);
      // 停在有字幕的位置，画面上「正在听到」才是有内容的
      await h.seek(3548, 2600);
      h.mark('ready');
      for (const [x, y] of [
        [1150, 520],
        [1400, 560],
        [1230, 700],
      ]) {
        await page.mouse.move(x, y, { steps: 30 });
        await h.sleep(1500);
      }
      await h.sleep(4200);
      h.mark('end');
    },
  ],
  '07': [
    'broll-teacher',
    async (page, h) => {
      // 收尾空镜：教师端停在工作台，沿热力图慢慢扫
      await page.goto(BASE + '/teacher', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.heatmap', { timeout: 60_000 });
      await h.sleep(2400);
      h.mark('ready');
      const box = await page.locator('.heatmap').boundingBox();
      if (box) {
        const y = box.y + box.height * 0.45;
        for (const ratio of [0.18, 0.38, 0.58]) {
          await page.mouse.move(box.x + box.width * ratio, y, { steps: 30 });
          await h.sleep(1500);
        }
      }
      await h.sleep(3600);
      h.mark('end');
    },
  ],
  '01': [
    'student-notes',
    async (page, h) => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await h.waitVideo();
      await h.play();
      await h.sleep(2400);
      h.mark('page-ready');
      await page.mouse.move(1560, 300, { steps: 18 });
      await h.sleep(800);

      const cards = [
        { time: T1, label: '没听懂', key: 'card1', typed: '1080×1920 哪个是宽哪个是高？' },
        { time: T2, label: '要照做', key: 'card2' },
        { time: T3, label: '有疑问', key: 'card3', typed: '磨皮到底该开多少？' },
      ];
      for (const card of cards) {
        await h.seek(card.time - 1.4, 1200);
        h.mark(`${card.key}-seek`);
        await h.click('.capture-button', 1300);
        h.mark(`${card.key}-composer`);
        if (card.typed) await h.rewrite(card.typed);
        await h.click(`.note-type:has-text("${card.label}")`, 900);
        h.mark(`${card.key}-typed`);
        await h.click('.primary-button:has-text("收进本节")', 1800);
        h.mark(`${card.key}-done`);
      }
      await h.hover('.note-list .note-card:first-child');
      await h.sleep(1200);
    },
  ],
  '02': [
    'seek-and-refresh',
    async (page, h) => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await h.waitVideo();
      await h.play();
      await h.sleep(1400);
      await h.click('.note-list .note-card:first-child .note-card__time', 2400);
      h.mark('seek-back');
      await h.sleep(800);
      await page.keyboard.press('F5');
      await page.waitForLoadState('domcontentloaded');
      await h.waitVideo();
      await h.sleep(2600);
      h.mark('after-refresh');
      await h.hover('.rail-footer');
      await h.sleep(1600);
    },
  ],
  '03': [
    'share-card',
    async (page, h) => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await h.waitVideo();
      await h.play();
      await h.sleep(1400);
      await h.click('.note-list .note-card:last-child .icon-text-button', 3200);
      h.mark('share-open');
      await page.locator('.share-preview img').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
      await h.hover('.share-preview img');
      await h.sleep(2600);
      h.mark('card-settled');
      await h.click('.share-actions .text-button', 1500);
      h.mark('copied');
      await h.sleep(1400);
      await h.click('.dialog-close', 1200);
      h.mark('closed');
    },
  ],
  '04': [
    'teacher-heatmap',
    async (page, h) => {
      await page.goto(BASE + '/teacher', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.heatmap', { timeout: 60_000 });
      await h.sleep(2600);
      h.mark('teacher-ready');

      // 沿热力图横向扫一遍，让剪辑能截「哪里红、哪里蓝」
      const box = await page.locator('.heatmap').boundingBox();
      if (box) {
        const y = box.y + box.height * 0.45;
        for (const ratio of [0.12, 0.28, 0.45, 0.62, 0.8]) {
          await page.mouse.move(box.x + box.width * ratio, y, { steps: 26 });
          await h.sleep(520);
        }
      }
      h.mark('heatmap-scan');

      await page.mouse.wheel(0, 520);
      await h.sleep(2000);
      h.mark('findings');
      await h.hover('.finding');
      await h.sleep(900);
      await h.click('.finding [data-range]', 1600);
      h.mark('locate');
      await h.sleep(1200);
    },
  ],
  '05': [
    'ai-review',
    async (page, h) => {
      await page.goto(BASE + '/teacher', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.heatmap', { timeout: 60_000 });
      await h.sleep(2200);
      h.mark('idle');
      await h.click('[data-gen-ai]', 900);
      h.mark('ai-click');
      await page
        .waitForFunction(
          () => {
            const b = document.querySelector('[data-gen-ai]');
            return Boolean(b && !b.disabled && b.textContent.includes('重新生成'));
          },
          { timeout: 180_000 },
        )
        .catch(() => console.warn('  ! 等 AI 生成超时'));
      h.mark('ai-done');
      await h.sleep(2200);
      await h.hover('.panel--insight');
      await h.sleep(2600);
      h.mark('ai-panel');
      await page.mouse.wheel(0, 260);
      await h.sleep(1800);
    },
  ],
  '06': [
    'back-to-student',
    async (page, h) => {
      await page.goto(BASE + '/teacher', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.heatmap', { timeout: 60_000 });
      await h.sleep(2600);
      h.mark('teacher-ready');

      const box = await page.locator('.heatmap').boundingBox();
      if (box) {
        const y = box.y + box.height * 0.5;
        for (const ratio of [0.15, 0.35, 0.55]) {
          await page.mouse.move(box.x + box.width * ratio, y, { steps: 24 });
          await h.sleep(420);
        }
      }

      await page.mouse.wheel(0, 520);
      await h.sleep(2000);
      h.mark('findings');
      await h.hover('.finding .fActs a');
      await h.sleep(800);
      await h.click('.finding .fActs a', 500);
      h.mark('click-back');
      await page.waitForLoadState('domcontentloaded');
      await h.waitVideo();
      await h.play();
      await h.sleep(2600);
      h.mark('student-same-second');
      await h.hover('.site-footer');
      await h.sleep(1800);
    },
  ],
};

for (const [index, [name, fn]] of Object.entries(SEGMENTS)) {
  if (pick.length && !pick.includes(index)) continue;
  await withPage(index, name, fn);
}

await browser.close();
fs.rmSync(TMP_DIR, { recursive: true, force: true });

const beatsFile = path.join(OUT_DIR, 'beats.json');
let merged = [];
if (fs.existsSync(beatsFile)) {
  const prev = JSON.parse(fs.readFileSync(beatsFile, 'utf8'));
  merged = (prev.segments ?? []).filter((s) => !results.some((r) => r.index === s.index));
}
merged = [...merged, ...results].sort((a, b) => a.index.localeCompare(b.index));
fs.writeFileSync(beatsFile, JSON.stringify({ segments: merged }, null, 1), 'utf8');
const total = results.reduce((sum, r) => sum + r.duration, 0);
console.log(`\n✅ ${results.length} 段，共 ${total.toFixed(1)}s`);
for (const r of results) console.log(`   ${r.index} ${r.name.padEnd(18)} ${String(r.duration).padStart(6)}s  ${r.marks.map((m) => `${m.name}@${m.t}`).join('  ')}`);
