# 秒记卡 Second Note

**学生点一下，秒数、字幕、自己的一句话一起留下；一个班点下来，老师看到的不是「多少人看完」，而是「哪一秒把人卡住了」。**

- **学生端**（`/`）：看保利威点播时点「记一下」→ 一张秒记卡（时间戳 + 平台字幕 + 可编辑摘要 + 类型）；点时间戳回到那一秒；可生成带二维码的分享卡，扫码直接跳到该秒。
- **教师端**（`/teacher`）：把全班的卡聚合成「时间 × 类型」热力图、热点区段、可执行结论；AI 复盘手动触发、按课缓存。

---

## 5 分钟跑起来

### 1. 装依赖

```powershell
cd 秒记卡
npm install          # Node ≥ 20
```

### 2. 配 `.env.local`（最少这 5 行）

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

```dotenv
POLYV_APP_ID=                # 保利威直播后台 → 设置 → 开发者信息
POLYV_APP_SECRET=
POLYV_VOD_USERID=            # 保利威点播后台 → 设置 → 开发者信息
POLYV_VOD_SECRETKEY=
POLYV_DEMO_CHANNEL_ID=       # 观看页地址 live.polyv.cn/watch/<这串数字>
```

> 没配也会启动，但学生端会显示「还差一步：配置频道号」的引导页——**不会**偷偷打开别人的频道。
> 全部 13 个变量（含 AI 复盘、换课怎么改）：见 [`docs/配置说明.md`](docs/配置说明.md)。

### 3. 启动，打开两个页面

```powershell
npm run demo
```

| 页面 | 地址 | 期望看到 |
|---|---|---|
| 学生端 | <http://127.0.0.1:8787/> | 右上角标签是「**真实频道**」，视频能播，点播放器右下「记一下」能出卡 |
| 教师端 | <http://127.0.0.1:8787/teacher> | 左栏 50 条点播，中间热力图；卡片少于 12 张会明确提示「样本偏少」 |

### 4.（可选）让教师端更有内容 / 打开 AI

```powershell
# 灌 8 张样例卡（走真实接口，和真人点的一模一样）
node scripts/seed-notes.mjs

# AI 复盘：在 .env.local 再加三行，然后重启
LLM_PROVIDER=dashscope
LLM_MODEL=qwen-plus
LLM_API_KEY=sk-...
```

---

## 目录

| 路径 | 是什么 |
|---|---|
| `秒记卡/` | **主项目**：学生端 + 教师端 + Express 签名代理（8787） |
| `docs/` | 配置说明、接口与函数说明、保利威 API/SDK 清单（xlsx） |
| `scripts/` | 演示辅助：灌样例卡、链路自检、同步教师端产物 |
| `demo-video/` | 演示录屏脚本与分镜表（视频素材留本地，不进版本库） |
| `src/`、`teacher.html`、`public/data/` | 早期教师端原型（原生 TS + 离线样本），历史保留，主链路在 `秒记卡/` |
| `docs/archive/` | 已作废的早期文档（ReLive 概念、60 秒脚本、agent 计划），仅供追溯 |

---

## 文档

| 文档 | 什么时候看 |
|---|---|
| [`docs/配置说明.md`](docs/配置说明.md) | 配不通、想确认参数从哪来、想换一场演示 |
| [`docs/接口与函数说明.md`](docs/接口与函数说明.md) | 要改代码：两套签名、每个接口的封装函数与参数 |
| [`docs/保利威-API与SDK清单.xlsx`](docs/保利威-API与SDK清单.xlsx) | 要交材料：9 条 API + 15 个 SDK 函数，标了是否使用 |
| [`秒记卡/演示脚本.md`](秒记卡/演示脚本.md) | 要上台讲：4 分钟动线与台词 |
| [`秒记卡/TEACHER.md`](秒记卡/TEACHER.md) | 教师端的数据口径与聚合规则 |
| `demo-video/剪辑素材/分镜表.md` | 要剪视频：8 段录屏素材与脚本小节的对应 |

---

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| 页面显示「还差一步：配置频道号」 | `.env.local` 没设 `POLYV_DEMO_CHANNEL_ID` |
| 视频空间是空的，控制台 `点播列表不可用` | 点播 `POLYV_VOD_USERID` / `POLYV_VOD_SECRETKEY` 没填或填错 |
| 教师端 AI 按钮是灰的 | 没配 `LLM_API_KEY`；配完要**重启**（不热重载） |
| 改了 `.env.local` 不生效 | `npm start` 只在启动时读一次 |
| 热力图很空 | 卡片 < 12 张，先 `node scripts/seed-notes.mjs` |

---

## 上传 GitHub 前

- `.env.local`、运行期数据（`秒记卡/work/`）、构建产物（`dist/`）已忽略；仓库里只有空值的 `.env.example`。
- 大目录不进库：`remotion-demo/`、`demo-video/成片/`、`demo-video/剪辑素材/**/*.mp4`、`痛点段-图片包/`、`秒记卡-交接包*`。
- 历史里曾把 AppSecret 硬编码在脚本中，已改为只读环境变量并从 git 历史清除。**仍建议去保利威后台重置一次 AppSecret**，再更新 `.env.local`。
- 交接包 zip 内含明文密钥，不要上传到任何公开位置。

> 技术栈：React 19 + Vite + TypeScript｜Node 20 + Express 4（签名代理）｜保利威点播 Open API + 智能字幕｜OpenAI 兼容模型｜Canvas 2D（分享卡 / 热力图）
