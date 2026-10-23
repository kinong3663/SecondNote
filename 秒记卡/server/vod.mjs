/**
 * 点播（VOD）视频库
 *
 * 用点播 Open API `GET /v2/video/search-videos` 拉账号里的点播视频：
 *   filters=basicInfo,transcodeInfo → 标题 / 时长 / 封面 / 直链 playUrl
 *
 * 为什么要拿 playUrl：点播视频的 mp4 直链可以直接用原生 <video> 播（实测 206 + CORS `*`），
 * 不必经过直播观看 SDK —— 那条路要求频道公开、且视频得挂进频道播放列表，限制更多。
 */
import { createHash } from 'node:crypto';

/** 点播签名：参数按名字典序 key=value 用 & 拼接，末尾直接接 secretkey，SHA1 大写 */
function vodSign(params, secretkey) {
  const raw = Object.keys(params)
    .filter((key) => params[key] !== '' && params[key] != null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${raw}${secretkey}`, 'utf8').digest('hex').toUpperCase();
}

async function vodGet(path, business, userid, secretkey) {
  const params = { ...business, userid, ptime: String(Date.now()) };
  params.sign = vodSign(params, secretkey);
  const url = new URL(`https://api.polyv.net${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  return response.json();
}

const pickPlayUrl = (item) => {
  const infos = item.transcodeInfos ?? [];
  const playable = infos.find((info) => info.status === 'normal' && info.playUrl);
  if (!playable) return { playUrl: '', format: '' };
  return { playUrl: String(playable.playUrl), format: String(playable.format ?? '') };
};

/** 点播视频列表（默认按创建时间倒序，只取已发布的） */
const listCache = new Map();
const LIST_TTL = 5 * 60 * 1000;

export async function fetchVodVideos({ userid, secretkey, pageSize = 50, title = '' } = {}) {
  if (!userid || !secretkey) throw new Error('未配置点播 userid / secretkey');
  const cacheKey = `${userid}:${pageSize}:${title}`;
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() - hit.at < LIST_TTL) return hit.value;

  const data = await vodGet(
    '/v2/video/search-videos',
    {
      filters: 'basicInfo,transcodeInfo',
      page: '1',
      pageSize: String(pageSize),
      sort: 'creationTimeDesc',
      ...(title ? { title } : {}),
    },
    userid,
    secretkey,
  );
  if (data.code !== 200) throw new Error(`点播列表失败：${data.message ?? data.code}`);
  const list = (data.data?.contents ?? []).map((item) => {
    const { playUrl } = pickPlayUrl(item);
    return {
      vid: String(item.vid),
      title: String(item.basicInfo?.title ?? '未命名点播'),
      duration: Number(item.basicInfo?.duration ?? 0),
      cover: String(item.basicInfo?.coverURL ?? ''),
      creationTime: String(item.basicInfo?.creationTime ?? ''),
      playUrl,
    };
  });
  listCache.set(cacheKey, { at: Date.now(), value: list });
  return list;
}

/** 单个点播视频（按 vid 精确匹配） */
export async function fetchVodVideo(vid, { userid, secretkey } = {}) {
  if (!userid || !secretkey) throw new Error('未配置点播 userid / secretkey');
  const data = await vodGet(
    '/v2/video/search-videos',
    { filters: 'basicInfo,transcodeInfo', page: '1', pageSize: '10', title: vid },
    userid,
    secretkey,
  );
  if (data.code !== 200) return null;
  const item = (data.data?.contents ?? []).find((entry) => String(entry.vid) === vid);
  if (!item) return null;
  return {
    vid,
    title: String(item.basicInfo?.title ?? ''),
    duration: Number(item.basicInfo?.duration ?? 0),
    cover: String(item.basicInfo?.coverURL ?? ''),
    playUrl: pickPlayUrl(item).playUrl,
  };
}
