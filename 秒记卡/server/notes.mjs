/**
 * 观众「秒记卡」的服务端镜像
 *
 * localStorage 仍是主存储（断网、清缓存都不影响观众自己回看），
 * 这里只是把卡片追加到 work/notes/<channelId>/<videoKey>.jsonl，供教师端聚合。
 * 一行一条 JSON，追加写，不重写文件 —— 并发写也不会互相覆盖。
 */
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const notesDir = path.join(projectRoot, 'work', 'notes');

/** 观众给卡片打的意义标签 —— 教师端热力图的分行依据 */
export const NOTE_TYPES = ['key', 'question', 'step', 'case', 'fix'];

export function notesFile(channelId, videoKey) {
  const safeChannel = String(channelId).replace(/[^0-9]/g, '') || 'unknown';
  const safeKey = String(videoKey).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  return path.join(notesDir, safeChannel, `${safeKey}.jsonl`);
}

export async function appendNote(note) {
  const file = notesFile(note.channelId, note.videoKey);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(note)}\n`, 'utf8');
  return file;
}

export async function listNotes(channelId, videoKey) {
  const file = notesFile(channelId, videoKey);
  try {
    const raw = await readFile(file, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * 统计每条视频收了多少张卡 / 多少人参与。
 * 文件名是 videoKey 把非字母数字换成下划线后的结果（vod_xxx），这里反解回来。
 */
export async function countNotesByVideo(channelId) {
  const dir = path.join(notesDir, String(channelId).replace(/[^0-9]/g, '') || 'unknown');
  const result = new Map();
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return result;
  }
  for (const name of files) {
    if (!name.endsWith('.jsonl')) continue;
    const stem = name.slice(0, -('.jsonl'.length));
    const sep = stem.indexOf('_');
    if (sep <= 0) continue;
    const videoKey = `${stem.slice(0, sep)}:${stem.slice(sep + 1)}`;
    try {
      const raw = await readFile(path.join(dir, name), 'utf8');
      const rows = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      result.set(videoKey, {
        cards: rows.length,
        viewers: new Set(rows.map((row) => row.visitorId).filter(Boolean)).size,
      });
    } catch {
      /* 单个文件读失败不影响其它 */
    }
  }
  return result;
}
