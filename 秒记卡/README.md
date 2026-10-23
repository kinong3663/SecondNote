# 秒记卡 Second Note

秒记卡是嵌入保利威定制观看页的学习辅助工具。观众在直播或回放中点击“记一下”，系统保存当前时间、附近字幕和可编辑摘要；之后可以从笔记列表回到原画面，并导出一张带回看二维码的分享卡。

## 技术结构

- React 19 + TypeScript + Vite
- 点播播放：保利威点播 mp4 直链 + 原生 `<video>`；`@polyv/live-watch-sdk` 作为没有直链时的回退
- Node.js + Express 服务端签名代理（直播 MD5、点播 SHA1 两套签名都只在服务端算）
- `localStorage` 本地笔记持久化（断网也能回看）
- Canvas PNG 分享卡 + `qrcode` 二维码
- 字幕：保利威点播**智能字幕**（`/v2/video/{userid}/srt/list`）；本地 `faster-whisper` 只作兜底，默认不启用
- 教师端：Canvas 2D 手绘热力图 + AI 复盘（OpenAI 兼容接口，手动触发、按课缓存）
- Vitest 单元测试

## 环境要求

- Node.js 20.19 或更高版本
- 可访问保利威 Open API
- 已配置观看页自定义域名的部署环境

## 本地启动

安装依赖：

```powershell
npm install
# 只有想用「本地转写兜底」时才需要：python -m pip install -r requirements-asr.txt
```

把模板复制成 `.env.local` 并填入 6 个必填项：

```dotenv
POLYV_APP_ID=              # 直播 AppID（直播后台 → 设置 → 开发者信息）
POLYV_APP_SECRET=          # 直播 AppSecret
POLYV_VOD_USERID=          # 点播 userid（点播后台 → 设置 → 开发者信息）
POLYV_VOD_SECRETKEY=       # 点播 secretkey
POLYV_DEMO_CHANNEL_ID=4711207
POLYV_DEMO_VIDEO_ID=       # 要演示的那条点播视频的 vid
```

可选：`LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` 用于教师端 AI 复盘，不配则只显示规则模板。

**13 个变量的完整说明、从哪儿拿、怎么验证配对了，见 [`../docs/配置说明.md`](../docs/配置说明.md)。**

构建并启动：

```powershell
npm run demo
```

打开 `http://127.0.0.1:8787`（学生端）与 `http://127.0.0.1:8787/teacher`（教师端）。

如果没有配置保利威密钥，应用仍会启动，但会明确显示“演示数据”。AppSecret 只在服务端使用，禁止改为 `VITE_` 环境变量。

## 常用命令

```powershell
npm run dev       # Vite 开发服务和 API 代理
npm test          # 运行全部单元测试
npm run build     # 类型检查并生成 dist
npm start         # 启动生产静态服务和 API
npm run demo      # 构建后启动可演示版本
```

## 演示内容

默认频道与视频由服务端 `.env.local` 决定（前端不写死），也可用 URL 参数临时覆盖：`?channelId=4711207&source=vod&id=<vid>`。

视频空间**只保留点播**：左侧列表来自保利威点播 Open API（默认 50 条，按创建时间倒序），点哪条播哪条；播放走 `transcodeInfos[].playUrl` 直链，不经过观看 SDK。

字幕优先用平台**点播智能字幕**（`srt/list`，当前演示视频 3472 条 cue）。平台没有字幕时界面不会用示意文本冒充，服务端提供 `POST /api/transcript` 作为本地 Whisper 兜底（默认不启用）。

## 核心流程

1. 在左侧点播列表里选一条视频（默认打开 `POLYV_DEMO_VIDEO_ID` 那条）。
2. 播放保利威点播（mp4 直链 + 原生 `<video>`）。
3. 点击播放器右下角的“记一下”。
4. 系统抓取当前秒数、附近字幕并生成可编辑摘要。
5. 选一个类型（重点 / 没听懂 / 要照做 / 案例 / 有疑问）后收进右侧「本节秒记」，同时上报服务端供教师端聚合。
6. 点击笔记时间戳，`video.currentTime = t` 回到那一秒。
7. 分享卡包含回看链接和二维码；链接使用 `t` 参数恢复播放位置。

切换视频时按「来源类型 + 视频 ID」读取独立笔记。教师端把同一批卡片聚合成热力图、热点与诊断：卡片 < 12 张时明确提示样本不足，不做强判断。

## 接入保利威观看页

本项目使用保利威推荐的官方观看页 SDK 进行定制。正式上线时需要在保利威直播后台的“开发设置 / 开发者信息”中加入部署域名，然后：

1. 将构建产物部署到已登记的 HTTPS 域名。
2. 通过观看页自定义菜单或独立观看入口链接到该页面。
3. 使用正式频道号替换默认频道。
4. 将演示字幕替换为平台字幕或业务方提供的逐字稿。
5. 如果启用本地识别，在生产环境安装 `requirements-asr.txt` 中的 Python 依赖。

## 安全说明

- `.env.local` 已被忽略，不会进入版本控制；仓库里只有空值的 `.env.example`。
- 平台密钥（AppSecret / secretkey）与模型 key 只在 Node 进程里读取，签名也在服务端计算，浏览器只拿到 `channelId` 与 `videoKey`。
- 禁止把密钥写成 `VITE_*`：Vite 会把它打进前端 bundle。
- 服务端不会返回 `appSecret`、频道口令或推流密钥。
- 首版没有登录和跨设备同步，清除浏览器数据会删除本地笔记。
- 交接包 zip 内含明文 `.env.local`，只用于本地交接，不要上传到公开位置。

## 首版边界

当前实现面向比赛 Demo：

- 单频道、多分类视频切换
- 匿名访客
- 本地笔记
- 单条笔记分享卡
- 可选本地 Whisper 字幕识别

云端笔记、账号体系、讲师后台和多场次课程树留作比赛后的产品化方向。
