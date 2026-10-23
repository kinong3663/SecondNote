const VISITOR_KEY = 'second-note:visitor-id';

/**
 * 本机匿名 ID —— 只用来在教师端区分"几张卡是同一个人点的"。
 * 不含任何个人信息、不上传到保利威、清缓存即消失。
 */
export function readVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return `anon-${Math.random().toString(16).slice(2, 10)}`;
  }
}
