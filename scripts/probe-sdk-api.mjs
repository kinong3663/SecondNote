/**
 * 从保利威观看 SDK 的产物里扒出它实际调用的接口路径 —— 用来定位「点播播不了」是哪一步。
 */
import fs from 'node:fs';
import path from 'node:path';

const SDK_DIR = path.join(process.cwd(), '秒记卡', 'node_modules', '@polyv', 'live-watch-sdk', 'lib');
const files = fs
  .readdirSync(SDK_DIR, { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.js'))
  .map((f) => path.join(SDK_DIR, f))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);

const target = files[0];
const source = fs.readFileSync(target, 'utf8');
console.log('bundle:', path.basename(target), (source.length / 1024).toFixed(0) + 'KB');

const found = new Set();
const patterns = [
  /\/live\/v\d+\/[a-z0-9_\-/{}]+/g,
  /\/live\/v\d+\/[a-z0-9_\-/]+/g,
  /\/v\d+\/[a-z0-9_\-/{}]+/g,
];
for (const re of patterns) {
  let m;
  while ((m = re.exec(source))) {
    if (m[0].length < 60) found.add(m[0]);
  }
}

const interesting = [...found]
  .filter((p) => /playback|record|video|material|vod|auth|channel/.test(p))
  .sort();

console.log('\n=== 与回放/点播相关的接口 ===');
for (const p of interesting) console.log(p);
