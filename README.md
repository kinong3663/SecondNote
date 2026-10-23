# 秒记卡 Second Note · 保利威黑客松

**学生点一下，秒数、字幕、自己的一句话一起留下；一个班点下来，老师看到的不是「多少人看完」，而是「哪一秒把人卡住了」。**

学生端在点播播放器上点「记一下」→ 生成一张秒记卡（时间戳 + 平台字幕 + 可编辑摘要 + 类型），点时间戳可回到那一秒，可生成带二维码的分享卡；教师端把全班的卡聚合成「时间 × 类型」热力图、热点区段与可执行的复盘建议，AI 诊断是手动触发的、按课缓存。

---

## 仓库结构

| 目录 / 文件 | 是什么 | 怎么跑 |
|---|---|---|
| **`秒记卡/`** | **主项目**：学生端（React 19 + Vite）+ 教师端（`/teacher`）+ Express 签名代理（8787） | `cd 秒记卡 && npm install && npm run demo` |
| `src/`、`teacher.html` | 早期教师端原型（原生 TS，读 `public/data` 的离线样本）。**属于历史版本，主链路在 `秒记卡/`** | `npm run dev` / `npm run build:teacher` |
| `public/data/` | 上面那个原型的离线样本（真实接口快照：场次、并发曲线、字幕、AI 大纲） | 静态读取 |
| `scripts/` | 数据拉取与演示辅助：`seed-notes.mjs`（灌样例卡）、`verify-live.mjs`（链路自检）、`sync-teacher.mjs`（同步教师端产物）等 | `node scripts/xxx.mjs` |
| `demo-video/` | 演示录屏脚本（Playwright）+ 分镜表 + 剪辑脚本。**视频素材留本地，不进库** | 见 `demo-video/剪辑素材/分镜表.md` |
| `docs/` | 配置说明、接口与函数说明、保利威 API/SDK 清单（xlsx）、多学生扩展方案 | 直接读 |
| `秒记卡-交接包/`、`秒记卡-交接包.zip` | 带便携 Node 运行时的本地交接包，**内含明文 `.env.local`**，仅本地使用（已 gitignore） | — |

---

## 快速开始

```powershell
cd 秒记卡
npm install
Copy-Item .env.example .env.local     # 填 6 个必填，见下
npm run demo                          # http://127.0.0.1:8787
```

- 学生端：<http://127.0.0.1:8787/>
- 教师端：<http://127.0.0.1:8787/teacher>

**没有密钥也能跑**：只 `npm install && npm run demo`，页面会明确显示「演示数据」，不会假装拿到了真数据。

## 配置（重点）

| 变量 | 必填 | 从哪儿拿 |
|---|---|---|
| `POLYV_APP_ID` / `POLYV_APP_SECRET` | ✅ | 保利威**直播**后台 → 设置 → 开发者信息（MD5 签名） |
| `POLYV_VOD_USERID` / `POLYV_VOD_SECRETKEY` | ✅ | 保利威**点播**后台 → 设置 → 开发者信息（SHA1 签名） |
| `POLYV_DEMO_CHANNEL_ID` / `POLYV_DEMO_VIDEO_ID` | ✅ | 观看页 URL 里的频道号 / 点播视频的 `vid` |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` | ⬜ | 模型厂商控制台；不配则教师端 AI 按钮变灰，其余功能正常 |

完整表格（13 个变量、不填会怎样、怎么验证配对了、换一场演示改哪三行、密钥安全边界）：
👉 **[`docs/配置说明.md`](docs/配置说明.md)**

> 密钥只从服务端环境变量读取，浏览器永远拿不到；`.env.local` 已被 `.gitignore` 忽略；**禁止**写成 `VITE_*`（会被打进前端 bundle）。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/配置说明.md`](docs/配置说明.md) | 环境变量全表、密钥怎么拿、怎么验证、别人 clone 后怎么改 |
| [`docs/秒记卡-接口与函数说明.md`](docs/秒记卡-接口与函数说明.md) | 保利威两套签名、每个接口的封装函数、参数与返回、报错对照 |
| [`docs/保利威-API与SDK清单.xlsx`](docs/保利威-API与SDK清单.xlsx) | 只含保利威：9 条 API + 15 个 SDK 函数（含是否使用） |
| [`秒记卡/演示脚本.md`](秒记卡/演示脚本.md) | 4 分钟演示动线与台词 |
| `demo-video/剪辑素材/分镜表.md` | 8 段录屏素材与脚本小节的对应、每个动作的秒数 |

---

## 技术栈

- **前端**：React 19 + TypeScript + Vite；点播视频用 `mp4 直链 + 原生 <video>`，`@polyv/live-watch-sdk` 作为无直链时的回退
- **服务端**：Node 20 + Express 4，两套签名（MD5 / SHA1）都在 Node 里算，兼做静态托管
- **字幕**：保利威点播智能字幕（`/v2/video/{userid}/srt/list`，实测 3472 条）
- **AI 复盘**：OpenAI 兼容接口（DeepSeek / 通义千问），手动触发 + 按课缓存 + 数字白名单校验（模型引用证据外的数字直接作废）
- **分享卡**：Canvas 2D 画 1080×1440 + `qrcode`
- **教师端**：Canvas 2D 手绘热力图（无图表库）

---

## 上传 GitHub 前请注意

- `.env.local`、运行期数据（`秒记卡/work/`）、构建产物（`dist/`）都已忽略。
- 大目录不进库：`remotion-demo/`（933MB）、`demo-video/成片/`、`demo-video/剪辑素材/**/*.mp4`、`痛点段-图片包/`、`秒记卡-交接包*`。
- 历史里曾有一次提交把 AppSecret 硬编码在 `scripts/pull-curves.mjs`，已改为只读环境变量并从历史中清理。**仍建议去保利威后台重置一次 AppSecret**，然后更新 `.env.local`。
- 交接包 zip 内含明文密钥，不要上传到任何公开位置。
