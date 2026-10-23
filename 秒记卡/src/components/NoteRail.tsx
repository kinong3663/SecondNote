import { NOTE_TYPES, type Note, type NoteType } from '../lib/notes';
import { formatTime } from '../lib/time';
import { NoteComposer } from './NoteComposer';

type Draft = {
  time: number;
  subtitle: string;
  summary: string;
  type: NoteType;
};

const typeLabel = (type: NoteType): string =>
  NOTE_TYPES.find((item) => item.id === type)?.label ?? '重点';

type NoteRailProps = {
  open: boolean;
  notes: Note[];
  duration: number;
  draft: Draft | null;
  activeNoteId: string | null;
  storageWarning: boolean;
  onClose: () => void;
  onSeek: (note: Note) => void;
  onShare: (note: Note) => void;
  onDelete: (note: Note) => void;
  onSummaryChange: (summary: string) => void;
  onTypeChange: (type: NoteType) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
};

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 11v5h12v-5" />
    </svg>
  );
}

export function NoteRail({
  open,
  notes,
  duration,
  draft,
  activeNoteId,
  storageWarning,
  onClose,
  onSeek,
  onShare,
  onDelete,
  onSummaryChange,
  onTypeChange,
  onSaveDraft,
  onCancelDraft,
}: NoteRailProps) {
  return (
    <aside className={`note-rail ${open ? 'note-rail--open' : ''}`} aria-label="本节秒记">
      <div className="note-rail__header">
        <div>
          <span className="eyebrow">THIS CHAPTER</span>
          <h2>
            本节秒记 <sup>{String(notes.length).padStart(2, '0')}</sup>
          </h2>
        </div>
        <button className="rail-close" type="button" onClick={onClose} aria-label="收起秒记">
          <span />
          <span />
        </button>
      </div>

      {storageWarning && (
        <p className="storage-warning" role="status">
          当前浏览器阻止了本地存储，关闭页面后笔记不会保留。
        </p>
      )}

      {draft && (
        <NoteComposer
          timeLabel={formatTime(draft.time)}
          subtitle={draft.subtitle}
          summary={draft.summary}
          type={draft.type}
          onSummaryChange={onSummaryChange}
          onTypeChange={onTypeChange}
          onSave={onSaveDraft}
          onCancel={onCancelDraft}
        />
      )}

      {notes.length > 0 && (
        <div className="chapter-progress" aria-label="秒记时间分布">
          <span className="chapter-progress__track" />
          {notes.map((note) => (
            <button
              key={note.id}
              className={`chapter-progress__dot ${activeNoteId === note.id ? 'is-active' : ''}`}
              style={{ left: `${Math.min(100, Math.max(0, (note.time / Math.max(duration, 1)) * 100))}%` }}
              type="button"
              onClick={() => onSeek(note)}
              aria-label={`回到 ${formatTime(note.time)}`}
            />
          ))}
        </div>
      )}

      <div className="note-list">
        {notes.length === 0 && !draft ? (
          <div className="empty-state">
            <div className="empty-state__orbit">
              <span />
              <span />
              <span />
            </div>
            <strong>还没有留下重点</strong>
            <p>播放时点一下「记一下」，这一秒的字幕、时间和理解就会留在这里。</p>
          </div>
        ) : (
          notes.map((note, index) => (
            <article
              key={note.id}
              className={`note-card ${activeNoteId === note.id ? 'is-active' : ''}`}
            >
              <div className="note-card__index">{String(index + 1).padStart(2, '0')}</div>
              <div className="note-card__body">
                <div className="note-card__meta">
                  <button
                    className="note-card__time"
                    type="button"
                    onClick={() => onSeek(note)}
                    aria-label={`回到 ${formatTime(note.time)}`}
                  >
                    <span>{formatTime(note.time)}</span>
                    <ArrowIcon />
                  </button>
                  <div className="note-card__actions">
                    <button
                      className="icon-text-button"
                      type="button"
                      onClick={() => onShare(note)}
                      aria-label={`分享 ${formatTime(note.time)} 的秒记`}
                    >
                      <ShareIcon />
                      分享
                    </button>
                    <button
                      className="delete-button"
                      type="button"
                      onClick={() => onDelete(note)}
                      aria-label={`删除 ${formatTime(note.time)} 的秒记`}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <p className="note-card__summary">{note.summary}</p>
                {note.subtitle && <p className="note-card__quote">“{note.subtitle}”</p>}
                <span className={`note-card__type note-card__type--${note.type}`}>
                  {typeLabel(note.type)}
                </span>
              </div>
            </article>
          ))
        )}
      </div>

      {notes.length > 0 && (
        <div className="rail-footer">
          <span>已为你留下 {notes.length} 个回看坐标</span>
          <span>本地自动保存</span>
        </div>
      )}
    </aside>
  );
}
