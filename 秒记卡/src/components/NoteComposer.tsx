import { useEffect, useRef } from 'react';
import { NOTE_TYPES, type NoteType } from '../lib/notes';

type NoteComposerProps = {
  timeLabel: string;
  subtitle: string;
  summary: string;
  type: NoteType;
  onSummaryChange: (summary: string) => void;
  onTypeChange: (type: NoteType) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function NoteComposer({
  timeLabel,
  subtitle,
  summary,
  type,
  onSummaryChange,
  onTypeChange,
  onSave,
  onCancel,
}: NoteComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="composer" aria-label="编辑秒记">
      <div className="composer__topline">
        <span className="time-pill">{timeLabel}</span>
        <span className="composer__hint">自动摘录 · 可编辑</span>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="取消这次秒记">
          ×
        </button>
      </div>

      <blockquote className="composer__quote">
        {subtitle || '这一秒附近暂时没有字幕，仍可记下自己的理解。'}
      </blockquote>

      <div className="note-types" role="group" aria-label="这条卡片的类型">
        {NOTE_TYPES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`note-type ${type === item.id ? 'is-active' : ''}`}
            aria-pressed={type === item.id}
            title={item.hint}
            onClick={() => onTypeChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="note-summary">
        这一刻的重点
      </label>
      <textarea
        ref={inputRef}
        id="note-summary"
        value={summary}
        maxLength={120}
        rows={3}
        onChange={(event) => onSummaryChange(event.target.value)}
      />
      <div className="composer__footer">
        <span>{summary.length}/120</span>
        <button className="text-button" type="button" onClick={onCancel}>
          再听听
        </button>
        <button className="primary-button" type="button" onClick={onSave} disabled={!summary.trim()}>
          收进本节
        </button>
      </div>
    </section>
  );
}
