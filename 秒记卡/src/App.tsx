import { useCallback, useEffect, useRef, useState } from 'react';
import { NoteRail } from './components/NoteRail';
import { PlayerStage } from './components/PlayerStage';
import { ShareCardDialog } from './components/ShareCardDialog';
import { VideoSwitcher } from './components/VideoSwitcher';
import { fallbackBundle } from './data/fallbackBundle';
import {
  readNotes,
  removeNote as removeStoredNote,
  reportNote,
  saveNote as saveStoredNote,
  type Note,
  type NoteType,
} from './lib/notes';
import { readVisitorId } from './lib/visitor';
import {
  seekSafely,
  seekWhenReady,
  type PlayerTime,
  type PolyvPlayerController,
} from './lib/polyv';
import { findNearbyCue, suggestSummary } from './lib/transcript';
import { formatTime } from './lib/time';
import type { SafeVideo } from './types';

const DEFAULT_CHANNEL_ID = '8569582';

type InjectedConfig = { channelId?: string; teacherUrl?: string };

/**
 * 服务端在首页注入演示配置（见 server/index.mjs），这样换一场演示只改 .env.local，
 * 不用重新构建前端。
 */
function readInjectedConfig(): InjectedConfig {
  if (typeof window === 'undefined') return {};
  const raw = (window as unknown as { __SECOND_NOTE_CONFIG__?: InjectedConfig })
    .__SECOND_NOTE_CONFIG__;
  return raw && typeof raw === 'object' ? raw : {};
}

type Draft = {
  time: number;
  subtitle: string;
  summary: string;
  type: NoteType;
};

function getBrowserStorage(): Storage | null {
  try {
    const probe = '__second_note_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function createNoteId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function RecordIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 4v16M4 12h16" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

export default function App() {
  const initialParams = new URLSearchParams(window.location.search);
  const requestedChannelId = initialParams.get('channelId');
  const requestedVideoId = initialParams.get('id') || initialParams.get('vid');
  const requestedSource = initialParams.get('source');
  const injected = readInjectedConfig();
  const configuredChannelId =
    injected.channelId && /^\d{4,20}$/.test(injected.channelId) ? injected.channelId : '';
  const channelId = requestedChannelId?.match(/^\d{4,20}$/)
    ? requestedChannelId
    : configuredChannelId || DEFAULT_CHANNEL_ID;
  const [bundle, setBundle] = useState(fallbackBundle);
  const [dataState, setDataState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [player, setPlayer] = useState<PolyvPlayerController | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackBundle.channel.duration);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shareNote, setShareNote] = useState<Note | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [notice, setNotice] = useState('');
  const [visitorId] = useState(readVisitorId);
  const restoredTimestamp = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setDataState('loading');

    const query = new URLSearchParams();
    if (requestedVideoId) query.set('vid', requestedVideoId);
    if (requestedSource) query.set('source', requestedSource);
    fetch(`/api/channel/${channelId}${query.size ? `?${query}` : ''}`)
      .then((response) => {
        if (!response.ok) throw new Error('频道接口不可用');
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setBundle(data);
        setDuration(data.channel.duration || fallbackBundle.channel.duration);
        setDataState(data.source === 'polyv' ? 'ready' : 'fallback');
      })
      .catch(() => {
        if (cancelled) return;
        setBundle(fallbackBundle);
        setDataState('fallback');
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, requestedSource, requestedVideoId]);

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!storage) {
      setStorageWarning(true);
      return;
    }

    try {
      setNotes(readNotes(storage, channelId, bundle.channel.videoKey));
    } catch {
      setStorageWarning(true);
    }
  }, [bundle.channel.videoKey, channelId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleTimeChange = useCallback(({ currentTime: time, durationTime }: PlayerTime) => {
    setCurrentTime(time);
    if (durationTime > 0) setDuration(durationTime);
  }, []);

  const handlePlayerReady = useCallback((nextPlayer: PolyvPlayerController | null) => {
    setPlayer(nextPlayer);
  }, []);

  useEffect(() => {
    if (!player || restoredTimestamp.current) return;
    const requestedTime = Number(new URLSearchParams(window.location.search).get('t'));
    if (!Number.isFinite(requestedTime) || requestedTime <= 0) return;
    restoredTimestamp.current = true;
    void seekWhenReady(player, requestedTime, duration).then((restored) => {
      if (restored) {
        setCurrentTime(Math.min(requestedTime, duration));
        setNotice(`已回到 ${formatTime(requestedTime)}`);
      } else {
        setNotice('当前内容还没有准备好跳转');
      }
    });
  }, [duration, player]);

  function beginCapture() {
    if (!player) {
      setNotice('播放器还在连接，请稍等一下');
      return;
    }
    if (currentTime <= 0) {
      setNotice('先播放到想记下的位置');
      return;
    }

    const cue = findNearbyCue(bundle.transcript, currentTime, 4);
    setDraft({
      time: currentTime,
      subtitle: cue?.text ?? '',
      summary: suggestSummary(bundle.transcript, currentTime, bundle.channel.videoTitle),
      type: 'key',
    });
    setRailOpen(true);
  }

  function updateDraftSummary(summary: string) {
    setDraft((current) => (current ? { ...current, summary } : current));
  }

  function updateDraftType(type: NoteType) {
    setDraft((current) => (current ? { ...current, type } : current));
  }

  function saveDraft() {
    if (!draft || !draft.summary.trim()) return;
    const nextNote: Note = {
      id: createNoteId(),
      channelId,
      videoId: bundle.channel.videoKey,
      time: draft.time,
      duration,
      subtitle: draft.subtitle,
      summary: draft.summary.trim(),
      type: draft.type,
      visitorId,
      createdAt: new Date().toISOString(),
    };

    // 先落本地（断网也能用），再异步上报给教师端
    const storage = getBrowserStorage();
    if (!storage) {
      setNotes((current) => [...current, nextNote].sort((a, b) => a.time - b.time));
      setStorageWarning(true);
    } else {
      try {
        setNotes(saveStoredNote(storage, nextNote));
      } catch {
        setNotes((current) => [...current, nextNote].sort((a, b) => a.time - b.time));
        setStorageWarning(true);
      }
    }
    void reportNote(nextNote);

    setActiveNoteId(nextNote.id);
    setDraft(null);
    setNotice('已收进本节秒记');
  }

  function seekToNote(note: Note) {
    if (!player) {
      setNotice('播放器还在连接，请稍等一下');
      return;
    }
    seekSafely(player, note.time, duration);
    setCurrentTime(Math.min(note.time, duration));
    setActiveNoteId(note.id);
    setNotice(`已回到 ${formatTime(note.time)}`);
  }

  function deleteNote(note: Note) {
    const storage = getBrowserStorage();
    if (storage) {
      setNotes(removeStoredNote(storage, channelId, bundle.channel.videoKey, note.id));
    } else {
      setNotes((current) => current.filter((item) => item.id !== note.id));
    }
    if (activeNoteId === note.id) setActiveNoteId(null);
    setNotice('已删除这条秒记');
  }

  function switchVideo(video: SafeVideo) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('channelId', channelId);
    nextUrl.searchParams.set('source', video.sourceType);
    nextUrl.searchParams.set('id', video.videoId);
    nextUrl.searchParams.delete('vid');
    if (video.sourceType === 'record') {
      nextUrl.searchParams.delete('playbackType');
    } else {
      nextUrl.searchParams.set('playbackType', video.sourceType);
    }
    nextUrl.searchParams.delete('t');
    window.location.assign(nextUrl.toString());
  }

  const sourceLabel =
    dataState === 'loading'
      ? '正在连接频道'
      : bundle.source === 'polyv' && dataState === 'ready'
        ? '真实频道'
        : '演示数据';
  // 教师端链接带上当前视频，回来时不会丢上下文
  const teacherHref = (() => {
    if (!injected.teacherUrl) return '';
    const query = new URLSearchParams();
    query.set('channelId', channelId);
    const [sourceType, videoId] = bundle.channel.videoKey.split(':');
    if (sourceType && videoId) query.set('vk', `${sourceType}:${videoId}`);
    return `${injected.teacherUrl}?${query.toString()}`;
  })();
  const activeVideo =
    bundle.videos.find(
      (video) =>
        video.sourceType === bundle.channel.videoSourceType &&
        video.videoId === bundle.channel.videoId,
    ) ??
    bundle.videos[0] ??
    fallbackBundle.videos[0];

  return (
    <div className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="site-header">
        <a className="brand" href="/" aria-label="秒记卡首页">
          <span className="brand__mark">
            <span />
          </span>
          <span className="brand__text">
            <strong>秒记卡</strong>
            <small>POLYV · SECOND NOTE</small>
          </span>
        </a>
        <div className="site-header__right">
          {bundle.transcriptSource === 'polyv' && (
            <span className="subtitle-note">平台字幕</span>
          )}
          {bundle.transcriptSource === 'ai' && (
            <span className="subtitle-note">AI 字幕</span>
          )}
          {bundle.transcriptSource === 'none' && (
            <span className="subtitle-note">暂无字幕</span>
          )}
          <span className={`source-chip source-chip--${bundle.source}`}>
            <i />
            {sourceLabel}
          </span>
          <button
            className={`mobile-notes-toggle ${railOpen ? 'is-open' : ''}`}
            type="button"
            onClick={() => setRailOpen((value) => !value)}
          >
            {railOpen ? '收起' : `秒记 ${notes.length}`}
          </button>
          {injected.teacherUrl && (
            <a className="teacher-entry" href={teacherHref}>
              教师端复盘
              <ArrowIcon />
            </a>
          )}
        </div>
      </header>

      <main className="workspace">
        <section className="watch-column">
          <div className="intro">
            <span className="eyebrow">ON-DEMAND LEARNING, REMEMBERED</span>
            <h1>
              别让重点
              <span>只留在视频里。</span>
            </h1>
            <p>
              边看、边记，关键处随时找回来。把一段点播视频变成可以带走的知识坐标。
            </p>
          </div>

          <section className="screen-card" aria-label="保利威点播播放器">
            <div className="screen-card__bar">
              <VideoSwitcher
                channel={bundle.channel}
                videos={bundle.videos}
                onSelect={switchVideo}
              />
              <div className="screen-card__meta">
                <span>{bundle.source === 'polyv' ? 'POLYV VOD' : 'DEMO FEED'}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="player-wrap">
              {dataState === 'loading' ? (
                <div className="player-loading-placeholder" role="status">
                  <span className="player-status__mark">·</span>
                  <div>
                    <strong>正在读取频道视频</strong>
                    <p>确认当前点播后再初始化播放器，避免短暂显示错误封面。</p>
                  </div>
                </div>
              ) : (
                <PlayerStage
                  channelId={channelId}
                  video={activeVideo}
                  onTimeChange={handleTimeChange}
                  onPlayerReady={handlePlayerReady}
                />
              )}
              <button
                className="capture-button"
                type="button"
                onClick={beginCapture}
                disabled={dataState === 'loading'}
              >
                <span className="capture-button__icon">
                  <RecordIcon />
                </span>
                <span className="capture-button__copy">
                  <small>{formatTime(currentTime)}</small>
                  <strong>记一下</strong>
                </span>
                <span className="capture-button__pulse" />
              </button>
            </div>

            <div className="screen-card__footer">
              <div className="now-reading">
                <span className="now-reading__label">正在听到</span>
                <p>
                  {findNearbyCue(bundle.transcript, currentTime, 4)?.text ??
                    '播放后，这里会跟随字幕显示你正在听的内容。'}
                </p>
              </div>
              <a
                className="watch-link"
                href={bundle.channel.watchUrl}
                target="_blank"
                rel="noreferrer"
              >
                原始视频
                <ArrowIcon />
              </a>
            </div>
          </section>

          <div className="value-strip">
            <div>
              <span>01</span>
              <p>一键捕捉当前画面与字幕</p>
            </div>
            <div>
              <span>02</span>
              <p>自动整理成可编辑的一句话</p>
            </div>
            <div>
              <span>03</span>
              <p>点回时间轴，原声原景重现</p>
            </div>
          </div>
        </section>

        <NoteRail
          open={railOpen}
          notes={notes}
          duration={duration}
          draft={draft}
          activeNoteId={activeNoteId}
          storageWarning={storageWarning}
          onClose={() => setRailOpen(false)}
          onSeek={seekToNote}
          onShare={setShareNote}
          onDelete={deleteNote}
          onSummaryChange={updateDraftSummary}
          onTypeChange={updateDraftType}
          onSaveDraft={saveDraft}
          onCancelDraft={() => setDraft(null)}
        />
      </main>

      <footer className="site-footer">
        <span>SECOND NOTE / 2026</span>
        <span>把视频看完，也把重点带走。</span>
      </footer>

      {notice && (
        <div className="toast" role="status">
          <span />
          {notice}
        </div>
      )}

      {shareNote && (
        <ShareCardDialog note={shareNote} channel={bundle.channel} onClose={() => setShareNote(null)} />
      )}
    </div>
  );
}
