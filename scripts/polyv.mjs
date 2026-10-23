#!/usr/bin/env node
/**
 * ReLive · 保利威三线数据拉取（在线人数 / 弹幕 / 回放字幕大纲）
 *
 * 用法：
 *   set POLYV_APP_ID=xxx
 *   set POLYV_APP_SECRET=xxx
 *   node scripts/polyv.mjs --line playback
 *   node scripts/polyv.mjs --line online   --start 1792656000 --end 1792742400
 *   node scripts/polyv.mjs --line chat     --start 1792656000 --end 1792742400
 *   node scripts/polyv.mjs --line outline
 *   node scripts/polyv.mjs --call /live/v3/channel/viewdata/concurrency --params channelId=4711207,startTime=...,endTime=...
 *
 * 签名规则（官方 /live/api/buildSign/）：
 *   1. 非空参数按 key 字典序升序
 *   2. 拼成 key1value1key2value2...
 *   3. 首尾拼 appSecret
 *   4. UTF-8 取 MD5，转大写
 */

import crypto from 'node:crypto';

const API = 'https://api.polyv.net';
const CHANNEL_ID = process.env.POLYV_CHANNEL_ID || '4711207';
const VIDEO_ID = process.env.POLYV_VIDEO_ID || 'bfcb278e7ad21906e061a344f3a949ec';

const APP_ID = process.env.POLYV_APP_ID;
const APP_SECRET = process.env.POLYV_APP_SECRET;

function sign(params, secret) {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  const raw = keys.map((k) => `${k}${params[k]}`).join('');
  return crypto.createHash('md5').update(`${secret}${raw}${secret}`, 'utf8').digest('hex').toUpperCase();
}

async function call(path, business = {}, { quiet = false } = {}) {
  const params = { ...business, appId: APP_ID, timestamp: Date.now() };
  params.sign = sign(params, APP_SECRET);
  const qs = new URLSearchParams(params).toString();
  const url = `${API}${path}?${qs}`;
  if (!quiet) console.log(`\n▶ GET ${path}\n  params: ${JSON.stringify(business)}`);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json };
}

function printResult(label, r) {
  const ok = r.status === 200 && (r.json.code === 200 || r.json.status === 'success' || Array.isArray(r.json.data));
  console.log(`  ${ok ? '✅' : '❌'} HTTP ${r.status} · ${r.json.code ?? r.json.status ?? '-'} · ${r.json.message ?? r.json.error?.desc ?? ''}`);
  if (ok) console.log(`  data: ${JSON.stringify(r.json.data).slice(0, 600)}`);
  return ok;
}

/** 候选接口（v3/v4 路径都有差异，逐个试；第一个是官方文档确认的） */
const LINES = {
  // ① 在线人数（历史并发，分钟级 → {day, minute, viewers}）
  online: (t) => [
    ['/live/v3/channel/statistics/concurrence', { channelId: CHANNEL_ID, startDate: t.startDate, endDate: t.endDate }],
    ['/live/v3/channel/statistics/concurrence', { channelId: CHANNEL_ID, startDate: t.startDate, endDate: t.endDate, userId: process.env.POLYV_USER_ID || '' }],
  ],
  // ② 弹幕 / 聊天记录（按秒聚合的成本就在这里）
  chat: (t) => [
    ['/live/v3/channel/chat/get_message_list', { channelId: CHANNEL_ID, startTime: t.start, endTime: t.end, page: 1, pageSize: 1000 }],
    ['/live/v3/channel/chat/get-message-list', { channelId: CHANNEL_ID, startTime: t.start, endTime: t.end, page: 1, pageSize: 1000 }],
    ['/live/v3/channel/chat/get_chat_list', { channelId: CHANNEL_ID, startTime: t.start, endTime: t.end }],
  ],
  // ③ 回放列表（确认 videoId 归属 + 时长 / 开始时间）
  playback: () => [
    ['/live/v3/channel/playback/get_playback_list', { channelId: CHANNEL_ID, page: 1, pageSize: 20 }],
    ['/live/v3/channel/playback/get-playback-list', { channelId: CHANNEL_ID, page: 1, pageSize: 20 }],
  ],
  // ④ 回放大纲 / 字幕地址（AI 看模块真正吃的 URL）
  outline: () => [
    ['/live/v4/channel/recordfile/get_record_file_outline', { channelId: CHANNEL_ID, videoId: VIDEO_ID }],
    ['/live/v4/channel/recordfile/get_record_file_outline', { channelId: CHANNEL_ID, fileId: VIDEO_ID }],
  ],
  // ⑤ 场次（三线对齐的时间基准）
  session: () => [
    ['/live/v3/channel/session/session_list', { channelId: CHANNEL_ID, page: 1, pageSize: 20 }],
  ],
};

// ---------- CLI ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

if (!APP_ID || !APP_SECRET) {
  console.error('缺少密钥。请先设置环境变量：');
  console.error('  $env:POLYV_APP_ID="你的appId"');
  console.error('  $env:POLYV_APP_SECRET="你的appSecret"');
  console.error('获取位置：保利威后台 → 设置 → 开发设置 → API 密钥（需账号管理员）');
  process.exit(2);
}

const day = (d) => d.toISOString().slice(0, 10);
const now = Date.now();
const t = {
  start: arg('start', Math.floor((now - 7 * 864e5) / 1000)),
  end: arg('end', Math.floor(now / 1000)),
  startDay: arg('startDay', day(new Date(now - 7 * 864e5))),
  endDay: arg('endDay', day(new Date(now))),
  // 并发接口要 yyyy-MM-dd（官方文档），默认拉最近 30 天
  startDate: arg('startDate', day(new Date(now - 30 * 864e5))),
  endDate: arg('endDate', day(new Date(now))),
};

try {
  if (argv.includes('--call')) {
    const path = arg('call');
    const business = {};
    for (const kv of (arg('params', '') || '').split(',').filter(Boolean)) {
      const [k, ...v] = kv.split('=');
      business[k] = v.join('=');
    }
    const r = await call(path, business);
    console.log(`\nHTTP ${r.status}\n${JSON.stringify(r.json, null, 2).slice(0, 4000)}`);
  } else {
    const line = arg('line', 'playback');
    const candidates = LINES[line];
    if (!candidates) {
      console.error(`未知 --line：${line}。可选：${Object.keys(LINES).join(' / ')}`);
      process.exit(1);
    }
    console.log(`频道 ${CHANNEL_ID} · videoId ${VIDEO_ID} · 时间窗 ${t.start} ~ ${t.end}`);
    let hit = false;
    for (const [path, business] of candidates(t)) {
      const r = await call(path, business, { quiet: true });
      const ok = printResult(path, r);
      if (ok) {
        hit = true;
        console.log(`\n=== 命中：${path} ===`);
        console.log(JSON.stringify(r.json.data, null, 2).slice(0, 3000));
        break;
      }
    }
    if (!hit) console.log('\n候选接口全未命中，用 --call 手动试，或把错误码发我看。');
  }
} catch (e) {
  console.error('请求失败：', e.message);
  process.exit(1);
}
