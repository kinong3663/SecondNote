import { beforeEach, describe, expect, it } from 'vitest';
import { readNotes, removeNote, saveNote, type Note } from './notes';

/**
 * 测试不依赖 jsdom 的 localStorage —— Node 24+ 自带的实验性 localStorage 全局
 * 会把 jsdom 的那份盖成 undefined，直接传一个内存版 Storage 更稳。
 */
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  } as Storage;
}

const note: Note = {
  id: 'note-1',
  channelId: '8569582',
  videoId: '77cb51cee7',
  time: 18,
  duration: 33,
  subtitle: '看一个具体案例。',
  summary: '用一个案例说明核心观点',
  type: 'key',
  visitorId: 'visitor-1',
  createdAt: '2026-10-23T08:00:00.000Z',
};

describe('note repository', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage();
  });

  it('persists and sorts notes by video time', () => {
    saveNote(storage, note);
    saveNote(storage, { ...note, id: 'note-2', time: 5 });
    expect(readNotes(storage, '8569582', '77cb51cee7').map((item) => item.id)).toEqual([
      'note-2',
      'note-1',
    ]);
  });

  it('removes one note without affecting other videos', () => {
    saveNote(storage, note);
    saveNote(storage, { ...note, id: 'other', videoId: 'other-video' });
    removeNote(storage, '8569582', '77cb51cee7', 'note-1');
    expect(readNotes(storage, '8569582', '77cb51cee7')).toEqual([]);
    expect(readNotes(storage, '8569582', 'other-video')).toHaveLength(1);
  });

  it('keeps the card type and falls back to 重点 for legacy notes', () => {
    saveNote(storage, { ...note, id: 'note-q', type: 'question' });
    const [saved] = readNotes(storage, '8569582', '77cb51cee7');
    expect(saved.type).toBe('question');

    storage.setItem(
      'second-note:8569582:77cb51cee7',
      JSON.stringify([{ ...note, id: 'legacy', type: undefined, visitorId: undefined }]),
    );
    const [legacy] = readNotes(storage, '8569582', '77cb51cee7');
    expect(legacy.type).toBe('key');
    expect(legacy.visitorId).toBe('');
  });
});
