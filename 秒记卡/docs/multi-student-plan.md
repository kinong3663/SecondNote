# 从「一个人」到「一个班」：多学生扩展方案

> 写于当前版本（学生端 + 教师端跑通单机演示之后）。
> 现状代码见 `server/notes.mjs`、`server/teacher.mjs`、`src/lib/visitor.ts`。

## 1. 现在是什么状态

| 能力 | 现状 | 说明 |
|---|---|---|
| 学生身份 | `localStorage` 里的随机 UUID | 不是「人」，是「一台浏览器」；换设备 / 清缓存 = 换一个人 |
| 卡片存储 | `work/notes/<channelId>/<videoKey>.jsonl` 追加写 | 并发安全（单行追加是原子的），但没有索引、没有事务 |
| 教师端身份 | 无 | 谁能打开 `/teacher` 谁就是老师；50 条课程对所有人可见 |
| 「学生 N」 | 前端按出现顺序编号 | 刷新一次可能换号，同一个人两台设备是两个 N |
| 实时性 | 8 秒轮询 | 人多了请求数 = 在线人数 × 7/分钟 |

一句话：**现在是「一台电脑上的匿名演示」，不是「一个班在上课」。**

## 2. 多学生到底意味着哪几件事

不是「把 viewerId 变成名单」这么简单，实际是四件事：

1. **身份**：谁在看？学号 / 手机号 / 微信 openid。没有身份，教师端的「这个学生反复标记同一段」就无从谈起。
2. **权限**：学生只能看自己选的课，老师只能看自己带的班。现在是全频道通吃。
3. **存储**：从「按视频追加一个 JSONL」到「可查询、可统计、可追溯」。
4. **隐私**：卡片内容是学生写的学习记录，比观看时长敏感得多，需要可见范围和删除权。

## 3. 分阶段路线

### 阶段 0 · 今天（已具备）
匿名 + 本地 ID + JSONL。**只用于演示**，不要带到正式课堂。

### 阶段 1 · 一个班，几十人（约 1 天）
- 学生首次进入填**姓名或学号**（存 `localStorage`，随卡片上报）
- 服务端不再信前端传的 `visitorId`，改用 `studentKey`
- 存储换成 **SQLite**（`better-sqlite3`），一张 `notes` 表 + 一张 `students` 表
- 教师端「学生 N」变成真实姓名，并可按学生筛选

这一阶段就能回答老师最常问的：「**张三到底记了什么？**」

### 阶段 2 · 多班多课，几百人（约 3–5 天）
- 引入 `courses` / `classes` / `enrollments`
- 加极简登录（手机号验证码，或对接学校统一认证）
- 教师端加「班级」维度：按班看热力图、按班导出
- 热点/统计改成**预聚合表**（卡片写入时就更新 `video_stats`），避免每次全表扫

### 阶段 3 · 多机构（暂时不需要）
- 多租户、异步队列、对象存储放截图、审计日志

## 4. 数据模型（阶段 2 的目标形态）

```sql
students(id, name, student_no, class_id, created_at)
classes(id, name, teacher_id)
enrollments(student_id, course_id)          -- 选课
courses(id, channel_id, video_key, title, duration)

notes(
  id            TEXT PRIMARY KEY,           -- 复用前端生成的 id，天然幂等
  student_id    TEXT NOT NULL,
  course_id     TEXT NOT NULL,
  t             INTEGER NOT NULL,           -- 相对视频秒数
  type          TEXT NOT NULL,              -- key|question|step|case|fix
  summary       TEXT,
  subtitle      TEXT,
  created_at    TEXT,
  UNIQUE(student_id, course_id, t, type)    -- 防止重复上报
)
CREATE INDEX idx_notes_course_t ON notes(course_id, t);

-- 预聚合：教师端首屏只查这张表
video_stats(
  course_id TEXT PRIMARY KEY,
  cards INTEGER, viewers INTEGER,
  by_type TEXT,                             -- JSON
  updated_at TEXT
)
```

为什么保留前端生成的 `id` 做主键：网络重试、`keepalive` 重复提交都会自动去重，不需要额外的幂等逻辑。

## 5. 接口改动

| 接口 | 现在 | 多学生后 |
|---|---|---|
| `POST /api/notes` | 信任 body 里的 `visitorId` | 从会话 cookie / token 解析 `student_id`，body 里的身份字段一律忽略 |
| `GET /api/teacher/:videoKey` | 无鉴权 | 校验「这个老师教这门课」 |
| `GET /api/vod-sessions` | 返回全区 50 条 | 只返回该老师/该班可见的课程 |
| 新增 `GET /api/me/notes` | — | 学生自己的卡片，支持跨设备同步 |
| 新增 `GET /api/teacher/:videoKey/students` | — | 每个学生的卡片数、最后活跃时间 |

## 6. 前端改动

**学生端**
- 首次进入的「我是谁」轻量登记（不要做成注册流程，填个名字就进）
- `localStorage` 从「唯一真相」降级为「离线缓存」：有网以服务端为准，断网仍可记，联网后补传
- 右侧秒记面板显示「仅自己可见」

**教师端**
- 左栏加「按学生筛选」，选中某个学生后热力图只统计他
- 卡片右上角从「学生 1」变成真实姓名 + 头像首字母
- 导出：按学生导出卡片清单（CSV / 图片）

## 7. 隐私与合规

- 卡片正文是学生自己的话，**默认只在本人 + 任课老师之间可见**，不进入任何公开榜单
- 教师端默认显示代号（学生 07），点「显示姓名」才实名
- 提供「删除我的秒记」入口，删除要级联到统计表
- 如果做跨校对比，必须先脱敏 + 聚合，不能出现个体

## 8. 最小可做的一步（建议先做这个）

不动数据库、不动登录，**2 小时内**就能让演示从「匿名」变成「有名字」：

1. 学生首次进入弹一个输入框「你的名字」，存 `localStorage`
2. `POST /api/notes` 多带一个 `studentName`
3. `server/notes.mjs` 的统计按 `studentName` 归并
4. 教师端把「学生 1」换成这个名字

这一步做完，老师就能说出「李四在 36'21" 记了三条，都在这段」——这是多学生的**最小可信形态**。
