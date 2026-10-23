/**
 * 把教师端构建产物和预置数据搬进秒记卡的 dist，交给同一个 Express 托管。
 * 用法：node scripts/sync-teacher.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const teacherDist = path.join(ROOT, 'dist-teacher');
const dataDir = path.join(ROOT, 'public', 'data');
const target = path.join(ROOT, '秒记卡', 'dist');

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest, filter);
    else if (filter(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

if (!fs.existsSync(teacherDist)) {
  // 观众端构建后会自动调用本脚本；教师端还没构建时不要当成失败
  console.warn('[sync-teacher] 跳过：还没有 dist-teacher（先跑 npm run build:teacher）');
  process.exit(0);
}

// 1. 页面 + 静态资源 → dist/teacher
copyDir(teacherDist, path.join(target, 'teacher'));

// 2. 预置数据 → dist/data（历史场次用；实时数据走 /api/teacher）
copyDir(dataDir, path.join(target, 'data'));

const count = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
};

console.log(`[sync-teacher] teacher → ${path.relative(ROOT, path.join(target, 'teacher'))}  ${count(path.join(target, 'teacher'))} 个文件`);
console.log(`[sync-teacher] data    → ${path.relative(ROOT, path.join(target, 'data'))}  ${count(path.join(target, 'data'))} 个文件`);
