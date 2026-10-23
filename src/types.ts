/** 数据契约类型 —— 与 data-contract.md 一一对应 */

export type Source = 'real' | 'sdk' | 'sim';
export type CurveKind = 'live-minute' | 'vod-second' | 'vod-ratio';

export interface Attendance {
  expected: number;
  actual: number;
  rate: number;
}

export interface Alignment {
  sessionId: string;
  fileId: string;
  evidence: string;
  offsetSec: number;
  durationDeltaSec: number;
  grade: 'verified' | 'weak' | 'none';
  watchUrl: string | null;
  hasSubtitle: boolean;
  hasOutline: boolean;
  note: string;
}

export interface Session {
  sessionId: string;
  /** live = 直播场次记录（≠ 回放）；vod = 点播原片 */
  kind?: 'live' | 'vod';
  title: string;
  alignment?: Alignment | null;
  startTime: number;
  endTime: number;
  durationMin: number;
  day: string;
  uniqueViewer: number;
  maxConcurrency: number;
  playCount: number;
  avgPlayDurationMin: number;
  attendance: Attendance | null;
  videoId: string | null;
  watchUrl: string | null;
  hasCurve: boolean;
  hasTopics: boolean;
  source: Source;
}

export interface SessionsFile {
  meta: {
    channelId: string;
    generatedAt: string;
    source: Source;
    note?: string;
    counts?: {
      liveSessions: number;
      vodItems: number;
      playbacks: number;
      withCurve?: number;
      withTopics?: number;
      verifiedAlignment?: number;
    };
  };
  sessions: Session[];
}

export interface CurvePoint {
  /** 相对开播秒 */
  t: number;
  /** 在线人数 */
  v: number;
}

export interface Curve {
  sessionId: string;
  kind: CurveKind;
  bucketSec: number;
  source: Source;
  origin?: string;
  points: CurvePoint[];
}

export interface TopicSegment {
  id: string;
  startSec: number;
  endSec: number;
  minutes: number;
  topic: string;
  text: string;
  cues: number;
  /** 官方章节之间可能重叠（语义上是包含关系） */
  overlapping?: boolean;
  rawEndSec?: number;
  summary?: string[];
  keyword?: string[];
  /** 换算到"直播开始后秒" */
  liveStartSec?: number;
  liveEndSec?: number;
}

export interface Topics {
  sessionId: string;
  source: 'asr' | 'manual' | 'ai-outline' | string;
  method?: string;
  origin?: string;
  durationSec: number;
  cues: number;
  segments: TopicSegment[];
}

export interface InteractionEvent {
  t: number;
  type: 'lottery' | 'checkin' | 'answer_card' | 'questionnaire' | 'like' | 'qa' | 'product' | 'gift' | 'notice' | 'chat' | string;
  joined?: number;
  total?: number;
  result?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  source: Source;
}

export interface Interactions {
  sessionId: string;
  source: Source;
  note?: string;
  events: InteractionEvent[];
}

/** 后台「视频库」里的可播放成片：直播回放或点播原片 */
export interface Replay {
  videoId: string;
  title: string;
  durationSec: number;
  durationMin: number;
  watchUrl: string | null;
  kind: 'live-replay' | 'vod';
  /** 绑定到的直播场次（无外键，仅在可唯一确定时才有值） */
  sessionId: string | null;
  matchedBy: string | null;
  bindNote?: string | null;
  hasTopics: boolean;
  hasCurve: boolean;
}

export interface ReplaysFile {
  meta: { generatedAt: string; source: Source; total: number; note?: string };
  replays: Replay[];
}

/** 完整度档位：A 三线齐 / B 缺一 / C 只有场次 */
export type Tier = 'A' | 'B' | 'C';

export interface DropPoint {
  tStart: number;
  tEnd: number;
  from: number;
  to: number;
  /** 相对下降（负值） */
  drop: number;
  /** 相对全场中位的异常度 */
  abnormal: number;
  topic: string | null;
  cause: string;
  rule: string;
  fix: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface Completeness {
  tier: Tier;
  has: string[];
  missing: string[];
  notes: string[];
}

/* ==================== 观众「记住卡」→ 教师端复盘 ==================== */

export type CardType = 'key' | 'question' | 'step' | 'case' | 'fix';

/** 观众端标记的一张卡（教师端只读） */
export interface MemoryCard {
  id: string;
  /** 相对本条回放播放进度的秒数 */
  t: number;
  /** 锚定的字幕条目序号（1 起），用于回放换片后重锚 */
  cue: number;
  quote: string;
  chapterId: string | null;
  chapter: string | null;
  type: CardType;
  viewer: string;
  note?: string;
  createdAt?: string;
}

export interface CardsFile {
  sessionId: string;
  source: Source;
  disclaimer?: string;
  viewers: number;
  cards: MemoryCard[];
}

export interface TeacherChapter {
  id: string;
  topic: string;
  t0: number;
  t1: number;
  minutes: number;
  cards: number;
  byType: Partial<Record<CardType, number>>;
  perMin: number;
}

export interface TeacherHotspot {
  id: string;
  rank: number;
  t0: number;
  t1: number;
  chapterId: string | null;
  chapter: string | null;
  cards: number;
  byType: Partial<Record<CardType, number>>;
  share: Partial<Record<CardType, number>>;
  score: number;
  perMin: number;
  /** 相对全场平均密度的倍数 */
  ratio: number;
  curve: { v0: number; v1: number; delta: number; peak: number } | null;
  samples: MemoryCard[];
}

export type FindingLevel = 'high' | 'medium' | 'low';

export interface TeacherFinding {
  id: string;
  kind: string;
  level: FindingLevel;
  t0: number;
  t1: number;
  title: string;
  /** 每条结论都必须能落到具体数字上，这是「不许编」的硬约束 */
  evidence: { k: string; v: string }[];
  judgment: string;
  action: string;
  cards: MemoryCard[];
}

export interface TeacherReport {
  sessionId: string;
  title: string;
  /** 实时场次才有：「来源:视频ID」，用来生成"回到学生点播"的链接 */
  videoKey?: string;
  day?: string | null;
  startTime?: number | null;
  generatedAt: string;
  engine: { evidence: string; narrative: string; prompt: string | null; model: string | null };
  reliability: { level: 'ok' | 'low'; reason: string };
  curveGate: { show: boolean; usable: boolean; peak: number | null; points: number; reason: string };
  source: { cards: Source; curve: Source | 'none'; chapters: string; disclaimer: string };
  jumpUrl: string | null;
  scale: {
    durationSec: number;
    durationMin: number;
    viewers: number;
    cards: number;
    perViewer: number;
    perMin: number;
    byType: Partial<Record<CardType, number>>;
    chapters: number;
    peak: number | null;
  };
  bucketSec: number;
  windowMin: number;
  grid: {
    types: CardType[];
    labels: Record<CardType, string>;
    rows: { type: CardType; counts: number[] }[];
    totals: number[];
    cellMax: number;
  };
  chapters: TeacherChapter[];
  covered: { t0: number; t1: number };
  hotspots: TeacherHotspot[];
  gaps: { kind: string; t0: number; t1: number; minutes: number; note: string }[];
  silences: { chapterId: string; chapter: string; t0: number; t1: number; minutes: number; cards: number }[];
  findings: TeacherFinding[];
  verdict: string | null;
  plan: string[] | null;
}

export interface TeacherIndexFile {
  meta: { generatedAt: string; engine: string; sessions: number };
  sessions: {
    sessionId: string;
    title: string;
    day?: string | null;
    cards: number;
    viewers: number;
    hotspots: number;
    findings: number;
    high: number;
    minutes: number;
    hasCurve: boolean;
    ai: boolean;
  }[];
}
