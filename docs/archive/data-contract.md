# ReLive 数据契约（Data Contract）v1

> **这份文件不是接口清单。** 接口清单说明"数据从哪取"（外部、会变、有 34 条已验）；
> 这份契约说明"交给前端和引擎的数据长什么样"（内部、定版、只有 4 张表）。
>
> 目的：**让"真实数据"和"模拟数据"在消费端完全不可区分** —— 换数据源不改一行前端代码。
>
> 状态：v1 定稿 ｜ 依据：频道 4711207 实测返回 ｜ 消费者：前端三屏 + 归因引擎

---

## 0. 四张表的关系

```
sessions.json                 ← 主表（一场直播一行），复盘的单位
   │  sessionId
   ├─ curves/<sessionId>.json        人数线（分钟级 / 秒级 / 完播桶）
   ├─ topics/<sessionId>.json        话题线（ASR 分段）
   └─ interactions/<sessionId>.json  互动线（抽奖/签到/答题/问卷/点赞/商品…）
```

三条线共用**同一根时间轴**：`t` = 相对开播的**秒数**（整数，从 0 开始）。
这是"三线对齐"的物理实现 —— 前端把三条线画在同一个 x 轴上，引擎按 `t` 取窗口。

---

## 1. `sessions.json` — 场次（主表）

```jsonc
{
  "meta": { "channelId": "4711207", "generatedAt": "2026-10-23T05:00:00Z", "source": "real" },
  "sessions": [
    {
      "sessionId": "hcg2c6sp48",            // 主键，保利威场次 ID
      "title": "AI数字人共创社学习空间",
      "startTime": 1761631500000,           // ms，开播时间
      "endTime": 1761640260000,             // ms，结束时间
      "durationMin": 146,

      "uniqueViewer": 27,                   // 独立观众
      "maxConcurrency": 13,                 // 峰值并发
      "playCount": 136,                     // 播放次数
      "avgPlayDurationMin": 10,             // 平均观看时长
      "attendance": { "expected": 138, "actual": 20, "rate": 0.145 },  // 到场率

      "videoId": "866bf851c5",              // 关联回放（可为 null）
      "watchUrl": "https://live.polyv.cn/watch/4711207?vid=866bf851c5",
      "source": "real"                      // real | sim
    }
  ]
}
```

| 字段 | 类型 | 必填 | 来源接口 | 现状 |
|---|---|---|---|---|
| `sessionId` | string | ✅ | `/live/v3/channel/session/list` | ✅ 17 场 |
| `startTime` / `endTime` | number(ms) | ✅ | 同上 | ✅ |
| `title` | string | ✅ | `/live/v4/statistics/session-stats/summary/list` | ✅ |
| `uniqueViewer` / `maxConcurrency` / `playCount` / `avgPlayDurationMin` | number | ✅ | 同上 | ✅ |
| `attendance.*` | object | 否 | 同上（`attendanceExpected/Actual`） | ✅ |
| `videoId` / `watchUrl` | string | 否 | `/live/v4/channel/playback/list` | ✅ 6 条 |

---

## 2. `curves/<sessionId>.json` — 人数线

三种来源，同一个形状：

```jsonc
{
  "sessionId": "hcg2c6sp48",
  "kind": "live-minute",        // live-minute | vod-second | vod-ratio
  "bucketSec": 60,              // 采样粒度（秒）
  "source": "real",
  "points": [
    { "t": 0, "v": 2 },
    { "t": 60, "v": 1 },
    { "t": 780, "v": 13 }
  ]
}
```

| `kind` | 含义 | 来源接口 | 现状 |
|---|---|---|---|
| `live-minute` | 该分钟**在线人数**（墙上时钟维度） | `/live/v3/channel/statistics/concurrence`（**必须单日查**） | ✅ 4 场（218/309 行） |
| `vod-second` | 视频第 N 秒**观看人数**（进度维度） | `/v2/videohot/{userid}` | ✅ 结构通，数据待积累 |
| `vod-ratio` | 看完 X% 的**人数分布**（10 桶） | `/v2/play-ratio/{userid}` | ✅ 有数据 |

> `vod-ratio` 的 `t` 用桶中值换算成秒：`t = percentage 中值 × durationSec`，这样三种曲线能画在同一根轴上。

---

## 3. `topics/<sessionId>.json` — 话题线

```jsonc
{
  "sessionId": "bfcb278e7a88e2d51e23ba453596ddf2_b",
  "source": "asr",              // asr | manual | ai-outline
  "method": "pause+merge+tf-title",
  "segments": [
    {
      "id": "a1",
      "startSec": 18,
      "endSec": 655,
      "minutes": 10.6,
      "topic": "流程｜我会给大家讲剪映 AI AU 数字人剪辑…",
      "text": "…（该段全部口播文字）…",
      "cues": 213
    }
  ]
}
```

| 字段 | 来源 | 现状 |
|---|---|---|
| `segments[].startSec/endSec` | 智能字幕 SRT 时间戳 | ✅ 3472 cue |
| `topic` | 算法：领域词命中 + 代表句 | ✅ 30 段 |
| `text` | SRT 拼接（已剥标签、多行补空格） | ✅ |

> 分段算法：停顿切块（>25s）→ 时长合并/递归切分（每段 ≤12 分钟）→ 标题。纯统计，不用 LLM，可复现。

---

## 4. `interactions/<sessionId>.json` — 互动线

**一张表装所有互动类型**，这是整个数据层的核心归一化：

```jsonc
{
  "sessionId": "hcg2c6sp48",
  "source": "real",
  "events": [
    {
      "t": 1420,                       // 相对开播秒
      "type": "lottery",               // 见下枚举
      "joined": 87,                    // 参与人数
      "total": 138,                    // 可参与人数（若有）
      "result": { "winnerCount": 5, "prize": "定制马克杯" },
      "payload": {},                   // 原始字段，供 UI 展示
      "source": "real"                 // real | sdk | sim
    }
  ]
}
```

`type` 枚举与来源：

| `type` | 含义 | 来源接口 | 现状 |
|---|---|---|---|
| `lottery` | 抽奖 | `/live/v4/channel/lottery/list`（`totalUsers/winnerCount/createdTime/sessionId`） | ✅ 通·0 条 |
| `checkin` | 签到 | `/live/v3/channel/checkin/list`、`/live/v3/channel/chat/checkin-by-sessionId` | ✅ 通·0 条 |
| `answer_card` | 答题卡（含正确率） | `/live/v3/channel/question/answer-records`、`list-question` | ✅ 通·0 条 |
| `questionnaire` | 问卷 | `/live/v3/channel/questionnaire/list-answer-records` | ✅ 通·0 条 |
| `like` | 点赞 | `/live/v4/channel/reward/like-list` | ✅ 通·0 条 |
| `qa` | 问答/提问 | `/live/v4/chat/list-qa`、`/live/v2/chat/{channelId}/getQuestion` | ✅ 通·0 条 |
| `product` | 商品点击/加购 | `/live/v4/channel/product/stats/summary` | ✅ 通·有字段 |
| `gift` | 打赏 | `/live/v4/channel/reward/gift-list` | ⚠️ 缺 `startTime` |
| `notice` | 公告 | `/live/v4/chat/list-bullentin` | ✅ 通·0 条 |
| `chat` | 弹幕（逐条） | 端上 `chat-replay` / `/live/v3/channel/chat/get-history-page` | ⚠️ 端上未接 |

---

## 5. 全局约定（四条，必须遵守）

1. **时间只有这样两种表示**：`t`（相对开播秒，整数）和 `ms`（绝对毫秒时间戳，字段名以 `Time` 结尾）。**不允许第三种。**
2. **每条数据都带 `source`**：`real` / `sdk` / `sim`，且必须一路带到报告里显示。这是产品可信度的地基。
3. **关联只走两个键**：`sessionId`（直播场次）、`videoId`（回放/点播）。
4. **缺失即降级，不许补零**：
   - 无 `curve` → 报告只出"场次级体检"（完整度 C）
   - 无 `interactions` → 明写"本场无互动数据"
   - 无 `topics` → 明写"无逐字稿，话题线缺失"

---

## 6. 消费端怎么用（伪代码）

```js
const session  = sessions.find(s => s.sessionId === id);
const curve    = load(`curves/${id}.json`)      ?? null;
const topics   = load(`topics/${id}.json`)      ?? null;
const interact = load(`interactions/${id}.json`) ?? null;

// 三条线共用一根 x 轴：t 秒
const timeline = mergeByT([curve?.points, topics?.segments, interact?.events]);

// 掉人点检测（只看 curve）
const drops = detectDrops(curve?.points ?? [], { windowSec: 180, minPeak: 20 });

// 归因（拿 drops 的时间窗去 topics / interactions 里找证据）
for (const d of drops) {
  d.topic  = topicAt(topics, d.tSec);
  d.events = eventsIn(interact, d.tSec, d.tSec + 180);
}
```

---

## 7. 封版检查清单

- [ ] 4 张表的字段名、类型、必填性冻结
- [ ] 每条 `source` 标注到位（real/sdk/sim）
- [ ] `t` 一律相对秒，`Time` 一律绝对毫秒
- [ ] 缺失降级规则写进报告模板
- [ ] 一份真实数据 + 一份模拟数据，能跑出**结构完全相同**的报告

> 最后一条是验收标准：如果换数据源报告结构变了，说明契约没落实。
