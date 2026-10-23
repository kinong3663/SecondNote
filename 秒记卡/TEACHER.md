# 教师端复盘台（Teacher Mode）

观众端的「秒记卡」记录的是**一个人**的回看坐标；教师端把**一场直播里所有人的卡**汇总起来，
回答讲师真正关心的问题：哪一段被反复标记、被标记成什么、下一期该改哪里。

```
http://127.0.0.1:8787/          观众端（秒记卡）
http://127.0.0.1:8787/teacher   教师端（复盘台）
```

## 一条卡片怎么从观众走到讲师

```
观众点「记一下」
  → 选类型（重点 / 没听懂 / 要照做 / 案例 / 有疑问，默认「重点」）
  → 自动带上当前秒数 + 附近字幕 + 可编辑摘要
  → 写 localStorage（主存储，断网也不丢）
  → POST /api/notes           （镜像到服务端 work/notes/<channelId>/<videoKey>.jsonl）
  → GET  /api/teacher/:videoKey?channelId=…
        · 2 分钟一格 × 5 类卡片 = 热力网格
        · 6 分钟滑窗 → 40% 阈值 → 连续段合并 → 收到 ≤12 分钟的「热点区段」
        · 章节：官方 AI 大纲，取「包含该秒的最深章节」（大纲可能是父章包住子章）
        · 闸门：卡片 < 12 张不出强结论；没有人数曲线就不谈「掉人」
  → 教师页每 8 秒拉一次，卡片数量有变化才重绘
```

## 三个接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/notes` | 观众卡片上报。`videoKey` 用「来源:视频ID」，如 `record:74f7a46b…` |
| `GET` | `/api/notes/:channelId/:videoKey` | 原始卡片（调试用） |
| `GET` | `/api/teacher/:videoKey?channelId=` | 聚合后的教师端报告 |

`/api/channel/:channelId` 现在会额外返回：

- `transcript` + `transcriptSource: 'polyv'` —— 保利威 AI 智能字幕（录制文件的 `subtitleList[0].srtUrl`），优先于本地 Whisper
- `chapters` —— 官方 AI 大纲的章节（标题 / 起止秒）

## 数据来源标注

**点播视频列表走点播 Open API（只展示点播，不混直播暂存 / 回放）：**

```
GET https://api.polyv.net/v2/video/search-videos
    ?userid=&ptime=&sign=&filters=basicInfo,transcodeInfo&page=1&pageSize=50&sort=creationTimeDesc
→ vid / title / duration / cover / transcodeInfos[].playUrl
```

点播签名和直播不一样：**参数按名字典序 `key=value` 用 `&` 拼接，末尾直接接 secretkey（不带 `&`）**，SHA1 后转大写。

**点播用 mp4 直链 + 原生 `<video>` 播放**（`playUrl` 实测 206 + `Access-Control-Allow-Origin: *`），
不经过直播观看 SDK —— 那条路要求频道公开、且视频必须挂进频道播放列表，限制更多。

**点播字幕同样走点播 Open API：**

```
GET https://api.polyv.net/v2/video/{userid}/srt/list?vid=&ptime=&sign=
→ data.srts[0].url   ← 直接当 SRT 拉下来解析
```

界面上的来源徽章：

| 徽章 | 含义 |
|---|---|
| 观众卡片：真实 | 观众端「记一下」实时上报（`work/notes/…jsonl`） |
| 章节：官方 AI 大纲 / 无 | 点播视频没有官方大纲，显示「无」，此时热点只按时间聚合 |
| 人数曲线：无 | 点播没有人数曲线，因此**不做人数交叉判断** |
| AI 解读：模板 | 实时数据用规则模板措辞；接大模型只需替换 `server/teacher.mjs` 里那段模板 |

## 演示动线

1. 打开 `/`，播放《AI数字人协会后期课程》，右上角能看到「平台字幕」
2. 播到任意位置点几次「记一下」，换着类型点（重点 / 没听懂 / 要照做 / 有疑问）
3. 切到 `/teacher`（页脚「教师端复盘 →」会自动带上当前视频；也可直接开 `/teacher?vk=vod:<vid>`）
4. 8 秒内热力图长出新格子，右侧出现诊断卡；点「在图上看这段」会框出区段并筛出对应卡片
5. 点右上角「← 回到学生点播」或诊断卡里的「去学生端看这段」，
   **回到同一个视频的同一秒**继续听 —— 教师端不是死胡同

教师端只复盘「观众端当前默认的那一条视频」，没有预置数据、没有场次切换：
`/teacher` 会从服务端注入的配置（`window.__TEACHER_CONFIG__`）拿到 `videoKey`，
拿不到就退回去问 `/api/channel`。

## 两个方向的「回到对方」

| 从 | 到 | 链接 |
|---|---|---|
| 教师端 → 学生端 | 同一视频 + 同一秒 | `/?channelId=…&source=<record\|vod>&id=<vid>&t=<秒>`（`t` 会被秒记卡播放器自动 seek） |
| 学生端 → 教师端 | 同一视频的复盘 | `/teacher?channelId=…&vk=<source>:<videoId>` |

## 构建与部署

教师端是独立构建的（vanilla TS，产物挂在同一个 Express 上）：

```powershell
# 在仓库根目录（ReLive 教师端工程）
npm run deploy:teacher   # = build:teacher + sync:teacher，把产物搬进秒记卡/dist
```

然后照常 `npm start`。注意 `秒记卡/dist/` 已被 gitignore，换机器要先跑一次 `deploy:teacher`。

## 演示前把卡片清零 / 灌一批

```powershell
# 清空（直接删目录里的 jsonl）
Remove-Item work\notes\4711207\*.jsonl

# 灌几张样例卡（覆盖 5 种类型，验证链路）
node scripts/seed-notes.mjs --keep
```

## 已知边界

- 匿名：观众身份是本机随机 UUID，不含个人信息，清缓存即重置
- 无账号：卡片只属于「这一台浏览器」+「这一条视频」
- 无实时推送：教师页是 8 秒轮询，不是 WebSocket
- 官方大纲可能缺失（`status: init`）：那一段会明确显示「官方大纲未覆盖」，卡片无法归章但不影响热力图
