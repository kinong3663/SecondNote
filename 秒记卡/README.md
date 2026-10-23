# 秒记卡（Second Note）· 主项目

学生端 + 教师端 + 签名代理都在这个目录里。

> **第一次上手别看这里**，先看根目录的 [`../README.md`](../README.md)（5 分钟版）；
> 配置参数看 [`../docs/配置说明.md`](../docs/配置说明.md)。

## 命令

| 命令 | 作用 |
|---|---|
| `npm install` | 装依赖（Node ≥ 20） |
| `npm run demo` | 构建 + 启动，学生端 <http://127.0.0.1:8787>，教师端 `/teacher` |
| `npm run dev` | 开发模式（Vite + API 热重载） |
| `npm start` | 只启动服务（读 `.env.local`） |
| `npm test` | 单元测试（23 个） |
| `npm run build` | 类型检查 + 构建，并把教师端同步进 `dist/teacher` |

## 目录

| 路径 | 内容 |
|---|---|
| `server/` | Express：`polyv.mjs`（直播 API + MD5 签名）、`vod.mjs`（点播 API + SHA1 签名）、`subtitles.mjs`（字幕/大纲）、`notes.mjs`（卡片存储）、`teacher.mjs`（聚合引擎）、`llm.mjs` + `summary.mjs`（AI 复盘）、`index.mjs`（路由） |
| `src/` | React 学生端（`App.tsx`、`components/`、`lib/`） |
| `work/` | 运行期数据：`notes/`（卡片）、`subtitles/`（字幕缓存）、`summaries/`（AI 缓存）。**已 gitignore** |
| `TEACHER.md` | 教师端数据口径与聚合规则 |
| `演示脚本.md` | 4 分钟演示动线与台词 |
| `docs/multi-student-plan.md` | 多学生扩展方案 |
| `.env.example` | 环境变量模板（复制成 `.env.local` 再填） |

## 前端约定

- 没有配置 `POLYV_DEMO_CHANNEL_ID` 时，学生端显示「还差一步：配置频道号」引导页，**不做静默兜底**。
- 服务端把配置注入 `window.__SECOND_NOTE_CONFIG__`，换课只改 `.env.local` 并重启，不用重新构建。
- 分享链接带 `?t=<秒>`，二维码内容就是这条 URL。

## 接口与函数

两套签名、每个接口的封装函数、参数与返回：[`../docs/接口与函数说明.md`](../docs/接口与函数说明.md)。
