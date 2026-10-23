# 秒记卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable Polyv custom watch-page demo where viewers can capture timestamped notes, persist them locally, revisit the original video moment, and export a share card.

**Architecture:** A React/Vite front end embeds the official Polyv Live Watch SDK and adds a note layer around it. A small Node server signs Polyv Open API requests with server-only credentials and returns sanitized channel metadata. Transcript matching, summary generation, note persistence, and sharing stay in focused client modules with unit tests.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Node.js, Express, `@polyv/live-watch-sdk`, `qrcode`.

**Spec:** `docs/superpowers/specs/2026-10-23-second-note-design.md`

## Global Constraints

- AppSecret only reads from the `POLYV_APP_SECRET` environment variable.
- Browser requests never include AppSecret, push URL, push secret, or raw Polyv credential payloads.
- Demo channel is `8569582`; demo video is `77cb51cee7`.
- Notes are scoped by channel ID and video ID and sorted by video time.
- Playback jump target is clamped to `0 <= time <= duration`.
- The first release does not include login, cloud sync, teacher controls, external LLM calls, or live speech recognition.
- The product must remain usable at desktop and mobile widths.
- Core UI copy is Chinese.

---

### Task 1: Scaffold And Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/lib/time.ts`
- Create: `src/lib/time.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: `formatTime(seconds: number): string`
- Produces: `clampTime(seconds: number, duration: number): number`
- Produces: `parseTimeLabel(label: string): number`

- [ ] **Step 1: Create the project manifest and test configuration**

```json
{
  "name": "second-note",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -k \"node --watch server/index.mjs\" \"vite --host 0.0.0.0\"",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "preview": "vite preview --host 0.0.0.0"
  },
  "dependencies": {
    "@polyv/live-watch-sdk": "latest",
    "express": "^4.21.2",
    "qrcode": "^1.5.4",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.3",
    "@types/node": "^24.3.0",
    "@types/qrcode": "^1.5.5",
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^5.0.2",
    "concurrently": "^9.2.1",
    "jsdom": "^26.1.0",
    "typescript": "^5.9.2",
    "vite": "^7.1.4",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install
```

Expected: `node_modules` and `package-lock.json` are created without an `ERESOLVE` error.

- [ ] **Step 3: Write failing time utility tests**

```ts
import { describe, expect, it } from 'vitest';
import { clampTime, formatTime, parseTimeLabel } from './time';

describe('time utilities', () => {
  it('formats short and long durations', () => {
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3723)).toBe('01:02:03');
  });

  it('clamps a requested seek time', () => {
    expect(clampTime(-2, 33)).toBe(0);
    expect(clampTime(42, 33)).toBe(33);
    expect(clampTime(12.8, 33)).toBe(12.8);
  });

  it('round-trips a time label', () => {
    expect(parseTimeLabel('01:02:03')).toBe(3723);
    expect(parseTimeLabel('01:05')).toBe(65);
  });
});
```

- [ ] **Step 4: Run the tests and verify failure**

Run:

```powershell
npm test -- src/lib/time.test.ts
```

Expected: FAIL because `src/lib/time.ts` does not exist.

- [ ] **Step 5: Implement the time utilities and minimal app shell**

`src/lib/time.ts`:

```ts
export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  const values = [minutes, remaining].map((value) => String(value).padStart(2, '0'));
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${values.join(':')}` : values.join(':');
}

export function clampTime(seconds: number, duration: number): number {
  return Math.min(Math.max(seconds, 0), Math.max(duration, 0));
}

export function parseTimeLabel(label: string): number {
  return label
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}
```

`src/App.tsx` is a temporary shell containing the heading `秒记卡` and a text placeholder for the player.

- [ ] **Step 6: Run tests and build**

Run:

```powershell
npm test -- src/lib/time.test.ts
npm run build
```

Expected: all tests pass and Vite creates `dist/`.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src .gitignore
git commit -m "chore: scaffold Second Note"
```

---

### Task 2: Polyv Service Adapter

**Files:**
- Create: `server/polyv.mjs`
- Create: `server/polyv.test.mjs`
- Create: `server/index.mjs`
- Create: `server/demoTranscript.mjs`
- Modify: `vite.config.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: environment variables `POLYV_APP_ID` and `POLYV_APP_SECRET`.
- Produces: `buildPolyvSign(params: Record<string,string>, appSecret: string): string`
- Produces: `sanitizeChannel(channel: Record<string, unknown>): SafeChannel`
- Produces: `GET /api/channel/:channelId` returning `{ channel, transcript, source }`

```ts
type SafeChannel = {
  channelId: string;
  name: string;
  watchStatus: string;
  watchStatusText: string;
  watchUrl: string;
  videoId: string;
  videoTitle: string;
  duration: number;
};
```

- [ ] **Step 1: Write failing signing and sanitization tests**

```js
import { describe, expect, it } from 'vitest';
import { buildPolyvSign, sanitizeChannel } from './polyv.mjs';

describe('Polyv signing', () => {
  it('sorts all non-empty parameters and wraps the secret', () => {
    const params = { timestamp: '2', appId: 'abc', ignored: '' };
    expect(buildPolyvSign(params, 'secret')).toBe('1467BF32B2EC2851FF4FAB474C5B6579');
  });

  it('removes credentials and stream secrets', () => {
    const safe = sanitizeChannel({
      channelId: 8569582,
      name: '11',
      watchUrl: 'https://live.polyv.cn/watch/8569582',
      watchStatus: 'playback',
      watchStatusText: '回放中',
      pushSecret: 'never-expose',
      channelPasswd: 'never-expose',
    });
    expect(safe.channelId).toBe('8569582');
    expect(safe).not.toHaveProperty('pushSecret');
    expect(safe).not.toHaveProperty('channelPasswd');
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```powershell
npm test -- server/polyv.test.mjs
```

Expected: FAIL because `server/polyv.mjs` does not exist.

- [ ] **Step 3: Implement signing and sanitization**

```js
import { createHash } from 'node:crypto';

export function buildPolyvSign(params, appSecret) {
  const raw = Object.keys(params)
    .filter((key) => params[key] !== '')
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  return createHash('md5').update(`${appSecret}${raw}${appSecret}`, 'utf8').digest('hex').toUpperCase();
}

export function sanitizeChannel(channel) {
  return {
    channelId: String(channel.channelId),
    name: String(channel.name ?? '未命名直播'),
    watchStatus: String(channel.watchStatus ?? 'unknown'),
    watchStatusText: String(channel.watchStatusText ?? '状态未知'),
    watchUrl: String(channel.watchUrl ?? ''),
  };
}
```

The HTTP adapter merges sanitized channel data with the demo video metadata and transcript fallback before responding.

- [ ] **Step 4: Add the service endpoint and Vite proxy**

`server/index.mjs` serves `/api/channel/:channelId` on port `8787`, reads credentials from environment variables, and never logs request parameters containing secrets. `vite.config.ts` proxies `/api` to `http://127.0.0.1:8787`.

- [ ] **Step 5: Configure local credentials without committing them**

Prompt for the secret without writing it into the plan or source code:

```powershell
$secret = Read-Host "Polyv AppSecret" -MaskInput
@"
POLYV_APP_ID=h9ufdoxtht
POLYV_APP_SECRET=$secret
"@ | Set-Content -Encoding utf8 .env.local
```

The actual secret is entered locally and must remain untracked. `.gitignore` includes `.env*` and allows `.env.example`.

Create `.env.example`:

```dotenv
POLYV_APP_ID=
POLYV_APP_SECRET=
```

- [ ] **Step 6: Verify signing tests and endpoint**

Run:

```powershell
npm test -- server/polyv.test.mjs
Invoke-RestMethod http://127.0.0.1:8787/api/channel/8569582
```

Expected: tests pass; response contains channel name `11`, video ID `77cb51cee7`, and no secret field.

- [ ] **Step 7: Commit**

```powershell
git add server vite.config.ts .gitignore .env.example
git commit -m "feat: add secure Polyv metadata adapter"
```

---

### Task 3: Transcript Matching And Summary

**Files:**
- Create: `src/lib/transcript.ts`
- Create: `src/lib/transcript.test.ts`
- Create: `src/data/demoTranscript.ts`

**Interfaces:**

- Produces: `type TranscriptCue = { start: number; end: number; text: string }`
- Produces: `findNearbyCue(cues: TranscriptCue[], currentTime: number, tolerance?: number): TranscriptCue | undefined`
- Produces: `suggestSummary(cues: TranscriptCue[], currentTime: number, fallbackTitle: string): string`

- [ ] **Step 1: Write failing matching and summary tests**

```ts
import { describe, expect, it } from 'vitest';
import { findNearbyCue, suggestSummary, type TranscriptCue } from './transcript';

const cues: TranscriptCue[] = [
  { start: 0, end: 4, text: '先理解问题的背景。' },
  { start: 5, end: 9, text: '再看一个具体案例。' },
  { start: 10, end: 15, text: '最后总结成三个步骤。' },
];

describe('transcript helpers', () => {
  it('finds a cue containing the current time', () => {
    expect(findNearbyCue(cues, 6)?.text).toBe('再看一个具体案例。');
  });

  it('finds the nearest cue within tolerance', () => {
    expect(findNearbyCue(cues, 9.6, 1)?.text).toBe('最后总结成三个步骤。');
    expect(findNearbyCue(cues, 30, 1)).toBeUndefined();
  });

  it('uses the title when no subtitle is available', () => {
    expect(suggestSummary([], 12, '民族团结视频')).toContain('民族团结视频');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
npm test -- src/lib/transcript.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement cue matching and deterministic summary**

```ts
export type TranscriptCue = { start: number; end: number; text: string };

export function findNearbyCue(
  cues: TranscriptCue[],
  currentTime: number,
  tolerance = 2.5,
): TranscriptCue | undefined {
  return cues
    .map((cue) => ({
      cue,
      distance:
        currentTime >= cue.start && currentTime <= cue.end
          ? 0
          : Math.min(Math.abs(currentTime - cue.start), Math.abs(currentTime - cue.end)),
    }))
    .filter((item) => item.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)[0]?.cue;
}

export function suggestSummary(
  cues: TranscriptCue[],
  currentTime: number,
  fallbackTitle: string,
): string {
  const cue = findNearbyCue(cues, currentTime, 4);
  if (!cue) return `回看「${fallbackTitle}」中的重点内容。`;
  const concise = cue.text.replace(/[。！？!?]+$/g, '').trim();
  return concise.length <= 28 ? concise : `${concise.slice(0, 27)}…`;
}
```

`src/data/demoTranscript.ts` contains timestamped captions matching the 33-second demo video. If the provider supplies publishable subtitles, those cues replace the local fallback.

- [ ] **Step 4: Run the tests**

Run:

```powershell
npm test -- src/lib/transcript.test.ts
```

Expected: all transcript tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/transcript.ts src/lib/transcript.test.ts src/data/demoTranscript.ts
git commit -m "feat: add transcript-aware note summaries"
```

---

### Task 4: Persistent Note Repository

**Files:**
- Create: `src/lib/notes.ts`
- Create: `src/lib/notes.test.ts`

**Interfaces:**

- Produces: `type Note`
- Produces: `noteStorageKey(channelId: string, videoId: string): string`
- Produces: `readNotes(storage: Storage, channelId: string, videoId: string): Note[]`
- Produces: `saveNote(storage: Storage, note: Note): Note[]`
- Produces: `removeNote(storage: Storage, channelId: string, videoId: string, noteId: string): Note[]`

```ts
type Note = {
  id: string;
  channelId: string;
  videoId: string;
  time: number;
  duration: number;
  subtitle: string;
  summary: string;
  createdAt: string;
};
```

- [ ] **Step 1: Write failing repository tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { readNotes, removeNote, saveNote, type Note } from './notes';

const note: Note = {
  id: 'note-1',
  channelId: '8569582',
  videoId: '77cb51cee7',
  time: 18,
  duration: 33,
  subtitle: '看一个具体案例。',
  summary: '用一个案例说明核心观点',
  createdAt: '2026-10-23T08:00:00.000Z',
};

describe('note repository', () => {
  beforeEach(() => localStorage.clear());

  it('persists and sorts notes by video time', () => {
    saveNote(localStorage, note);
    saveNote(localStorage, { ...note, id: 'note-2', time: 5 });
    expect(readNotes(localStorage, '8569582', '77cb51cee7').map((item) => item.id)).toEqual([
      'note-2',
      'note-1',
    ]);
  });

  it('removes one note without affecting other videos', () => {
    saveNote(localStorage, note);
    saveNote(localStorage, { ...note, id: 'other', videoId: 'other-video' });
    removeNote(localStorage, '8569582', '77cb51cee7', 'note-1');
    expect(readNotes(localStorage, '8569582', '77cb51cee7')).toEqual([]);
    expect(readNotes(localStorage, '8569582', 'other-video')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
npm test -- src/lib/notes.test.ts
```

Expected: FAIL because `notes.ts` is missing.

- [ ] **Step 3: Implement the repository with safe JSON fallback**

```ts
export type Note = {
  id: string;
  channelId: string;
  videoId: string;
  time: number;
  duration: number;
  subtitle: string;
  summary: string;
  createdAt: string;
};

export function noteStorageKey(channelId: string, videoId: string): string {
  return `second-note:${channelId}:${videoId}`;
}

export function readNotes(storage: Storage, channelId: string, videoId: string): Note[] {
  try {
    const value = JSON.parse(storage.getItem(noteStorageKey(channelId, videoId)) ?? '[]');
    return Array.isArray(value)
      ? value.filter((item): item is Note => typeof item?.id === 'string').sort((a, b) => a.time - b.time)
      : [];
  } catch {
    return [];
  }
}

export function saveNote(storage: Storage, note: Note): Note[] {
  const notes = [...readNotes(storage, note.channelId, note.videoId), note].sort((a, b) => a.time - b.time);
  storage.setItem(noteStorageKey(note.channelId, note.videoId), JSON.stringify(notes));
  return notes;
}

export function removeNote(
  storage: Storage,
  channelId: string,
  videoId: string,
  noteId: string,
): Note[] {
  const notes = readNotes(storage, channelId, videoId).filter((note) => note.id !== noteId);
  storage.setItem(noteStorageKey(channelId, videoId), JSON.stringify(notes));
  return notes;
}
```

- [ ] **Step 4: Run the tests**

Run:

```powershell
npm test -- src/lib/notes.test.ts
```

Expected: both repository tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/notes.ts src/lib/notes.test.ts
git commit -m "feat: persist timestamped notes"
```

---

### Task 5: Polyv Player Stage

**Files:**
- Create: `src/lib/polyv.ts`
- Create: `src/components/PlayerStage.tsx`
- Create: `src/types/polyv.d.ts`
- Modify: `src/App.tsx`
- Modify: `index.html`

**Interfaces:**

- Consumes: `SafeChannel`
- Produces: `PlayerStageProps` with `currentTime`, `duration`, `ready`, `error`, `onTimeChange`, `onSeek`, and `telemetry`
- Produces: `createPolyvWatchCore(channelId: string): Promise<PolyvWatchCore>`

- [ ] **Step 1: Create an adapter test for safe player operations**

```ts
import { describe, expect, it, vi } from 'vitest';
import { seekSafely } from './polyv';

describe('seekSafely', () => {
  it('clamps requested times and calls the player once', () => {
    const seekVideo = vi.fn();
    seekSafely({ seekVideo }, 40, 33);
    expect(seekVideo).toHaveBeenCalledWith(33);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
npm test -- src/lib/polyv.test.ts
```

Expected: FAIL because `seekSafely` is not implemented.

- [ ] **Step 3: Implement the player adapter**

```ts
import { clampTime } from './time';

export function seekSafely(
  player: { seekVideo: (time: number) => void },
  requestedTime: number,
  duration: number,
): void {
  player.seekVideo(clampTime(requestedTime, duration));
}
```

The rest of `src/lib/polyv.ts` lazily loads the official UMD SDK, creates `watchCore` with the configured channel ID, calls `setup()`, verifies no-auth access with `verifyNoneAuth()`, calls `connect()`, obtains the single playback target, and creates the player.

- [ ] **Step 4: Implement the player component**

`PlayerStage.tsx` renders a 16:9 player container and listens to `PlayerEvents.TimeUpdate`. It exposes the player instance through a callback, shows loading and error states, and calls `onTimeChange({ currentTime, durationTime })` on each update.

- [ ] **Step 5: Run unit tests and build**

Run:

```powershell
npm test -- src/lib/polyv.test.ts
npm run build
```

Expected: the adapter test passes and TypeScript reports no unknown SDK errors.

- [ ] **Step 6: Manually verify the real channel loads**

Run:

```powershell
npm run dev
```

Open `http://localhost:5173`, then verify channel `8569582` renders and time advances.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/polyv.ts src/lib/polyv.test.ts src/components/PlayerStage.tsx src/types/polyv.d.ts src/App.tsx index.html
git commit -m "feat: embed Polyv playback"
```

---

### Task 6: Note Composer, Note Rail, And Share Card

**Files:**
- Create: `src/components/NoteComposer.tsx`
- Create: `src/components/NoteRail.tsx`
- Create: `src/components/ShareCardDialog.tsx`
- Create: `src/lib/shareCard.ts`
- Create: `src/lib/shareCard.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `TranscriptCue[]`, `Note[]`, current time, duration, and `seekSafely`.
- Produces: `buildInterpolatedShareUrl(channelUrl: string, time: number): string`
- Produces: `drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): Promise<void>`

```ts
type ShareCardData = {
  channelName: string;
  videoTitle: string;
  summary: string;
  subtitle: string;
  timeLabel: string;
  qrDataUrl: string;
};
```

- [ ] **Step 1: Write a failing share URL test**

```ts
import { describe, expect, it } from 'vitest';
import { buildInterpolatedShareUrl } from './shareCard';

describe('share links', () => {
  it('preserves existing query parameters and adds the note time', () => {
    expect(
      buildInterpolatedShareUrl(
        'https://live.polyv.cn/watch/8569582?vid=77cb51cee7&playbackType=vod',
        18,
      ),
    ).toBe(
      'https://live.polyv.cn/watch/8569582?vid=77cb51cee7&playbackType=vod&t=18',
    );
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
npm test -- src/lib/shareCard.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the URL helper and Canvas renderer**

```ts
export function buildInterpolatedShareUrl(channelUrl: string, time: number): string {
  const url = new URL(channelUrl);
  url.searchParams.set('t', String(Math.max(0, Math.floor(time))));
  return url.toString();
}
```

The Canvas renderer draws a 1080 x 1440 dark card with the title, summary, source quote, timestamp, brand mark, and 320 px QR code. It uses a warm off-white text color and the accent `#38d6b0`.

- [ ] **Step 4: Build the note composer interaction**

Clicking `记一下`:

1. Reads `currentTime` and `duration`.
2. Calls `findNearbyCue` and `suggestSummary`.
3. Opens the composer with editable summary and read-only source quotation.
4. Saves a `crypto.randomUUID()` note and closes after a short success state.

Clicking a note timestamp calls `onSeek(note.time)` and marks that note as active.

- [ ] **Step 5: Build the share card dialog**

The dialog previews the generated PNG, provides a `下载分享卡` button, and provides `复制回看链接`. QR generation uses `qrcode.toDataURL` with error correction level `M`.

- [ ] **Step 6: Run unit tests and build**

Run:

```powershell
npm test
npm run build
```

Expected: all unit tests pass and production assets are generated.

- [ ] **Step 7: Manually verify the full loop**

Verify:

```text
Play → 记一下 → edit summary → save → refresh → note remains
→ click timestamp → video seeks → export share card
```

Expected: every transition responds without a page reload.

- [ ] **Step 8: Commit**

```powershell
git add src/components src/lib/shareCard.ts src/lib/shareCard.test.ts src/App.tsx src/styles.css
git commit -m "feat: add note capture and share cards"
```

---

### Task 7: Responsive Polish And Delivery Verification

**Files:**
- Modify: `src/styles.css`
- Modify: `src/App.tsx`
- Create: `README.md`
- Create: `work/demo-script.md`

**Interfaces:**

- Consumes: the complete app.
- Produces: a runnable local demo, competition talking points, and a repeatable 60-second demo script.

- [ ] **Step 1: Implement responsive layouts**

At widths above `900px`, show a 380 px note rail beside the player. Below `900px`, hide the rail until opened and present the composer as a bottom sheet. Keep the record button above player controls with `bottom: 82px`.

- [ ] **Step 2: Add accessible interaction states**

Every icon-only button has an `aria-label`. Dialog uses `role="dialog"` and visible close buttons. Focus outlines remain visible. Motion respects `prefers-reduced-motion`.

- [ ] **Step 3: Write the README and 60-second demo script**

The README contains:

```text
Requirements
Environment setup
npm run dev
npm test
npm run build
Polyv custom watch-page deployment note
```

The demo script contains these beats:

```text
00:00 Introduce the problem: viewers leave knowledge inside video.
00:10 Start the Polyv replay and capture one note.
00:25 Show that the source quote, time, and summary were captured.
00:35 Refresh and show the note persists.
00:45 Click back to the video moment and export the card.
00:55 State the business value: completion, retention, revisit.
```

- [ ] **Step 4: Run all automated checks**

Run:

```powershell
npm test
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 5: Verify secret isolation**

Run:

```powershell
rg -n "POLYV_APP_SECRET\s*=\s*[A-Za-z0-9]{20,}" . -g '!node_modules/**' -g '!.env.local'
rg -n "pushSecret|appSecret" dist
```

Expected: the first command returns no matches; the second returns no credential values.

- [ ] **Step 6: Run desktop and mobile visual checks**

Capture screenshots at `1440x1000` and `390x844`, then verify:

- Player is not obscured by controls.
- The record button remains tappable.
- The note rail does not overflow.
- The share dialog fits inside the viewport.
- Long Chinese summaries wrap without overlapping.

- [ ] **Step 7: Commit**

```powershell
git add src README.md work/demo-script.md
git commit -m "polish: finalize competition demo"
```
