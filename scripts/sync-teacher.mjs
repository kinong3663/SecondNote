/**
 * 把教师端构建产物搬进秒记卡的 dist，交给同一个 Express 托管（/teacher）。
 *
 * 用法：在仓库根目录或 秒记卡/ 里都可以跑
 *   node scripts/sync-teacher.mjs
 *
 * 注意：仓库根目录是用本文件位置算出来的，不是 process.cwd() ——
 * 因为 秒记卡/package.json 的 postbuild 会用 秒记卡/ 作为工作目录调用它。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const teacherDist = path.join(ROOT, 'dist-teacher');
const target = path.join(ROOT, '秒记卡', 'dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

if (!fs.existsSync(teacherDist)) {
  // 观众端构建后会自动调用本脚本；教师端还没构建时不要当成失败
  console.warn('[sync-teacher] 跳过：还没有 dist-teacher（先跑 npm run build:teacher）');
  process.exit(0);
}

copyDir(teacherDist, path.join(target, 'teacher'));

const count = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n += 1;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
};

console.log(
  `[sync-teacher] teacher → ${path.relative(ROOT, path.join(target, 'teacher'))}  ${count(
    path.join(target, 'teacher'),
  )} 个文件`,
);
