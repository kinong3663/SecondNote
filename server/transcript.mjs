import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const transcriptDir = path.join(projectRoot, 'work', 'transcripts');
const inFlight = new Map();

export class TranscriptServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'TranscriptServiceError';
    this.status = status;
  }
}

export function isAllowedMediaUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'videocc.net' ||
      host.endsWith('.videocc.net') ||
      host === 'polyv.cn' ||
      host.endsWith('.polyv.cn') ||
      host === 'polyv.net' ||
      host.endsWith('.polyv.net')
    );
  } catch {
    return false;
  }
}

export function transcriptCacheKey(sourceType, videoId) {
  return `${String(sourceType).replace(/[^a-z]/gi, '')}:${String(videoId).replace(
    /[^a-z0-9_-]/gi,
    '_',
  )}`;
}

export function normalizeWhisperSegments(segments) {
  return segments
    .map((segment) => ({
      start: Math.max(0, Number(segment.start) || 0),
      end: Math.max(0, Number(segment.end) || 0),
      text: String(segment.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((segment) => segment.text && segment.end >= segment.start);
}

async function ensureCacheDirectory() {
  await mkdir(transcriptDir, { recursive: true });
}

function cachePath(sourceType, videoId) {
  return path.join(transcriptDir, `${transcriptCacheKey(sourceType, videoId)}.json`);
}

export async function readCachedTranscript(sourceType, videoId) {
  try {
    const raw = await readFile(cachePath(sourceType, videoId), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.cues) ? data : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function runWhisper(mediaUrl) {
  const python = process.env.ASR_PYTHON || 'python';
  const script = path.join(__dirname, 'transcribe_whisper.py');
  const pythonPath = [process.env.PYTHONPATH, path.join(projectRoot, 'work', 'python-libs')]
    .filter(Boolean)
    .join(path.delimiter);

  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, mediaUrl], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath,
        PYTHONIOENCODING: 'utf-8',
        HF_HOME: path.join(projectRoot, 'work', 'hf-cache'),
        WHISPER_DOWNLOAD_ROOT: path.join(projectRoot, 'work', 'whisper-models'),
        WHISPER_MEDIA_DIR: path.join(projectRoot, 'work', 'asr-media'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 5_000_000) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 30_000) stderr += chunk;
    });
    child.on('error', () => {
      reject(
        new TranscriptServiceError(
          '本地语音识别组件未安装，请运行 pip install -r requirements-asr.txt。',
          503,
        ),
      );
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new TranscriptServiceError(
            stderr.trim() || '本地语音识别失败，请检查模型和依赖。',
            503,
          ),
        );
        return;
      }

      try {
        const data = JSON.parse(stdout);
        resolve({
          cues: normalizeWhisperSegments(data.segments || []),
          model: String(data.model || 'faster-whisper'),
          hasSpeech: Boolean(data.segments?.length),
        });
      } catch {
        reject(new TranscriptServiceError('识别结果格式异常。', 502));
      }
    });
  });
}

export async function transcribeMedia({ sourceType, videoId, mediaUrl }) {
  if (!['record', 'playback', 'vod'].includes(sourceType)) {
    throw new TranscriptServiceError('视频分类不正确。', 400);
  }
  if (!videoId || videoId.length > 100) {
    throw new TranscriptServiceError('视频 ID 不正确。', 400);
  }
  if (!isAllowedMediaUrl(mediaUrl)) {
    throw new TranscriptServiceError('媒体地址必须来自保利威视频域名。', 400);
  }

  const cached = await readCachedTranscript(sourceType, videoId);
  if (cached) return { ...cached, cached: true };

  const key = transcriptCacheKey(sourceType, videoId);
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    const result = await runWhisper(mediaUrl);
    const value = {
      sourceType,
      videoId,
      mediaUrl,
      model: result.model,
      hasSpeech: result.hasSpeech,
      cues: result.cues,
      createdAt: new Date().toISOString(),
    };
    await ensureCacheDirectory();
    await writeFile(cachePath(sourceType, videoId), JSON.stringify(value, null, 2), 'utf8');
    return { ...value, cached: false };
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}
