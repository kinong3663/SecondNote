# ReLive · 数据源全量盘点（API + SDK）

> 扫了开发者中心（`polyv.net/dev/`）、云直播服务端 API 全目录、云点播 API 全目录（94 个接口）、观看页/互动/AI 三个 WebSDK 目录。
> 状态标记：✅ 已用你的密钥实测通过 ｜ 📄 文档确认存在、未实测 ｜ ❓ 路径未定位

---

## 0. 一句话结论

**三线里"人数"和"弹幕"能靠接口/SDK 拿到；"讲师话题"也能拿到 —— 但走的是点播侧的「智能字幕」接口（平台自带 ASR），不是直播接口。**
前提：视频必须在**点播库**里。你这 6 条回放挂在直播存储，所以点播智能字幕会报"非法VID"（我试过了）。

---

## 1. 签名体系（重要，决定能不能调）

| 体系 | 适用 | 签名参数 | 状态 |
|---|---|---|---|
| **MD5（appId 制）** | 云直播 v3/v4、**云点播 v4** | `appId + timestamp + sign`，sign = MD5(secret+按 key 排序拼接+secret) 大写 | ✅ 已用官方测试向量校验并实调通过 |
| **SHA1（userid 制）** | 云点播 v2 老接口 | `userid + ptime + sign`，按参数名字典序拼 key=value 后 SHA1 | 📄 文档确认，需点播 `userid` |

> **关键发现**：点播的 **v4** 接口接受**直播的 appId 密钥**。我用同一套 appId/secret 调 `/vod/v4/smart-subtitle/get`，返回"字幕任务不存在"而不是"签名错误" → 签名通过。这意味着一个 appId 能同时驱动直播与点播 v4。

---

## 2. 云直播服务端 API（✅ 已实测）

| 数据 | 接口 | 实测结果 |
|---|---|---|
| 场次列表 | `GET /live/v3/channel/session/list` | ✅ 17 场，`{sessionId, startTime, endTime, userId}` |
| 回放视频 | `GET /live/v4/channel/playback/list`（参数 `channelIds`） | ✅ 6 条，`{videoId, videoPoolId, duration, name, watchUrl}` |
| 历史并发 | `GET /live/v3/channel/statistics/concurrence`（`startDate/endDate`） | ⚠️ 每天仅 1 条（时间点恒 00:00），全年峰值 13 人 |
| AI 大纲/字幕 | `GET /live/v4/watch/channel/playback/outline/get-by-fileId` | ⚠️ 通但 `data:null`（频道未开通 AI） |

## 3. 云直播服务端 API（📄 未实测，按目录可接）

| 数据 | 目录项 | 复盘价值 |
|---|---|---|
| 聊天记录 | 数据统计-聊天 | 弹幕线 |
| 观看详情 / viewlog | 数据统计-观看详情（viewlog_2 / viewlog_page / daily_summary） | 人均时长、完成率 |
| 答题卡结果 | 数据统计-答题卡结果 | **正确率低的题 = 那段没讲清** |
| 签到记录 | 数据统计-签到 | 到场漏斗 |
| 问卷结果 | 数据统计-问卷 | 满意度结论 |
| 抽奖记录 | 数据统计-抽奖 | 互动峰值 |
| 商品统计 | 数据统计-商品库 | 转化节点 |
| 点赞记录 | 数据统计-点赞 | 共鸣信号 |
| 实时并发 | 查询频道实时并发数据 | 直播中看板 |

---

## 4. 云点播 API（回放所在侧，94 个接口里的关键 8 个）

### 4.1 语义层 / 字幕（★★★ 这是"讲了什么"的正解）

| 接口 | 说明 | 状态 |
|---|---|---|
| `GET /vod/v4/smart-subtitle/get` | 查询智能字幕（参数 `taskId`；返回 `link` 字幕链接） | ✅ 签名通过（无任务） |
| `POST /vod/v4/smart-subtitle/create` | **创建智能字幕任务（平台自带 ASR）** | ✅ 端点存在（要求 POST）；❌ 我们的回放报"非法VID" |
| `POST /vod/v4/smart-subtitle/publish` | 发布字幕（自动应用到视频） | 📄 |
| 字幕任务回调 | `/vod/api/subtitle_task_callback/` | 📄 异步通知，含结果 |

> 路径含义：**平台能自己把音轨转成字幕**，我们不用装 whisper。只是这批回放不在点播库。
> 解决路径：把回放转存到点播库（直播后台"批量转存暂存视频到云点播"），或直接上传一段视频进点播。

### 4.2 观看行为 / 留存（★★★ 最可能补上"分钟级曲线"）

| 接口 | 说明 | 备注 |
|---|---|---|
| `GET /v2/video/engagement/{userid}/get` | **单视频观看完成度** | 老接口，SHA1 + userid |
| `GET /v2/advance/play/{userid}` | **观看行为分析**（播放进度分布） | 若能拿到"每个时间点观众数"，就是分钟级留存曲线 |
| `GET /v2/video/.../get_viewlog` | 批量观看日志 | 单条观看记录（含起止时间） |
| `/vod/api/statistics/get_play_duration/` | 播放时长统计 | 汇总 |

### 4.3 弹幕 / 问答 / 打点

| 接口 | 说明 |
|---|---|
| `GET /v2/danmu/{userid}` | 点播弹幕列表（时间轴弹幕） |
| 查询打点 `chapter_marker/get_chapter_marker` | **现成的章节打点** = 话题分段的人工产物 |
| 获取答题记录 `quiz/get_quiz_result` | 播放器弹题的正确率 |

---

## 5. WebSDK 侧（观众页面里能采到的，最实用）

| SDK | 数据 | 为什么重要 |
|---|---|---|
| 观看页 `chat` | 聊天消息、**聊天重放 chat-replay** | 回放时能重放当初弹幕 → 弹幕线不用等接口 |
| 观看页 `player` | 卡顿/缓冲/清晰度/seek/倍速 | **"卡顿 3 次正好是掉人点"= 技术锅 vs 内容锅** |
| 观看页 `playback` | 进度、完成率 | 留存代理 |
| 观看页 `emotion-feedback` / `like` | 情绪、点赞 | 共鸣曲线 |
| 互动接收端 | 答题卡/签到/抽奖/问卷/公告/卡片/商品/问答/话题PK/云席 | 互动全量事件，含正确率 |
| 互动发起端 | **可主动发起这些互动** | "半真实演练"：真发真采 |
| AI SDK | 大纲/字幕/答题数据 | 若客户开通 AI，直接拿 SRT |

---

## 6. 落到复盘的映射（哪条线从哪来）

| 三线 | 首选来源 | 备选 | 兜底 |
|---|---|---|---|
| **在线人数** | 直播 `concurrence`（**只有日峰值**） | 点播 `advance/play` 进度分布（可能有分钟级） | 播放器 SDK 进度事件自采 / sim |
| **弹幕** | 观看页 `chat-replay`（回放弹幕） | 直播聊天记录接口 / 点播 `/v2/danmu` | 互动 SDK 自采 / sim |
| **讲师话题** | 点播 `smart-subtitle`（平台 ASR） | 本地 whisper ASR | 运营台本 |
| 播放质量 | 观看页 `player` 事件 | — | 无（如实标注缺口） |
| 互动理解度 | 答题卡结果（正确率） | 问答记录 | sim |

---

## 7. 下一步验证清单（各 5 分钟）

1. **把一条回放转存到点播库** → 再调 `POST /vod/v4/smart-subtitle/create` → 拿 `link` → 话题线变 real（最高价值）
2. 拿到点播 `userid`（后台"开发设置"里的另一组密钥）→ 试 `advance/play` 看有没有分钟级留存
3. 抓一次观看页 HAR → 确认 `chat-replay` 有没有真实弹幕历史
4. 试直播"聊天记录"接口的真实路径（翻一次文档页即可）

> 第 1 条如果成立，你的复盘就能同时拥有：**真实场次 + 真实峰值 + 真实字幕 + 真实回放跳转**，只把"分钟曲线"标为模拟。这已经是能打的 demo 了。
