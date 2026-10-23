export type NoteType = 'key' | 'question' | 'step' | 'case' | 'fix';

/** 观众点一下就算打标 —— 类型决定教师端热力图的哪一行亮起来 */
export const NOTE_TYPES: { id: NoteType; label: string; hint: string }[] = [
  { id: 'key', label: '重点', hint: '想留下结论' },
  { id: 'question', label: '没听懂', hint: '需要讲师细讲' },
  { id: 'step', label: '要照做', hint: '操作步骤' },
  { id: 'case', label: '案例', hint: '想搬回自己场景' },
  { id: 'fix', label: '有疑问', hint: '疑似讲错，待核对' },
];

export const isNoteType = (value: unknown): value is NoteType =>
  NOTE_TYPES.some((item) => item.id === value);

export type Note = {
  id: string;
  channelId: string;
  videoId: string;
  /** 相对本条视频的播放进度（秒） */
  time: number;
  duration: number;
  subtitle: string;
  summary: string;
  type: NoteType;
  /** 匿名观众 ID（本机生成，不含任何个人信息），教师端用它算参与人数 */
  visitorId: string;
  createdAt: string;
};

export function noteStorageKey(channelId: string, videoId: string): string {
  return `second-note:${channelId}:${videoId}`;
}

export function readNotes(storage: Storage, channelId: string, videoId: string): Note[] {
  try {
    const value = JSON.parse(storage.getItem(noteStorageKey(channelId, videoId)) ?? '[]');
    return Array.isArray(value)
      ? value
          .filter((item): item is Note => typeof item?.id === 'string')
          .map((item) => ({
            ...item,
            type: isNoteType(item.type) ? item.type : 'key',
            visitorId: typeof item.visitorId === 'string' ? item.visitorId : '',
          }))
          .sort((a, b) => a.time - b.time)
      : [];
  } catch {
    return [];
  }
}

export function saveNote(storage: Storage, note: Note): Note[] {
  const notes = [...readNotes(storage, note.channelId, note.videoId), note].sort(
    (a, b) => a.time - b.time,
  );
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

/**
 * 上报到服务端，供教师端聚合。
 * localStorage 仍是主存储：这里失败（断网、后端没起）只记一条日志，不影响观众自己回看。
 */
export async function reportNote(note: Note): Promise<void> {
  try {
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: note.id,
        channelId: note.channelId,
        videoKey: note.videoId,
        type: note.type,
        time: note.time,
        duration: note.duration,
        subtitle: note.subtitle,
        summary: note.summary,
        visitorId: note.visitorId,
        createdAt: note.createdAt,
      }),
      keepalive: true,
    });
  } catch {
    /* 离线演示时静默失败 */
  }
}
