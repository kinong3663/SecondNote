/**
 * 模型调用（OpenAI 兼容协议）
 *
 * 默认走 DeepSeek；本机没有 DeepSeek key 时会自动识别 DashScope（通义千问兼容模式），
 * 也可以用 LLM_PROVIDER / LLM_BASE_URL / LLM_MODEL / LLM_API_KEY 完全指定。
 *
 * 注意：key 只在服务端读取，永远不下发到浏览器。
 */

const DEEPSEEK_BASE = 'https://api.deepseek.com';
const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export function resolveProvider() {
  const explicit = String(process.env.LLM_PROVIDER || '').toLowerCase();
  const key =
    process.env.LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    '';

  if (explicit === 'deepseek') {
    return {
      name: 'deepseek',
      baseUrl: process.env.LLM_BASE_URL || DEEPSEEK_BASE,
      model: process.env.LLM_MODEL || 'deepseek-chat',
      key,
    };
  }
  if (explicit === 'dashscope') {
    return {
      name: 'dashscope',
      baseUrl: process.env.LLM_BASE_URL || DASHSCOPE_BASE,
      model: process.env.LLM_MODEL || 'qwen-plus',
      key,
    };
  }
  if (explicit === 'custom') {
    return {
      name: 'custom',
      baseUrl: process.env.LLM_BASE_URL || '',
      model: process.env.LLM_MODEL || '',
      key,
    };
  }

  // 没指定：有 DeepSeek key 就用 DeepSeek，否则退到 DashScope
  if (process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY) {
    return {
      name: 'deepseek',
      baseUrl: process.env.LLM_BASE_URL || DEEPSEEK_BASE,
      model: process.env.LLM_MODEL || 'deepseek-chat',
      key,
    };
  }
  if (process.env.DASHSCOPE_API_KEY) {
    return {
      name: 'dashscope',
      baseUrl: process.env.LLM_BASE_URL || DASHSCOPE_BASE,
      model: process.env.LLM_MODEL || 'qwen-plus',
      key,
    };
  }
  return { name: 'none', baseUrl: '', model: '', key: '' };
}

async function post(path, body, key, timeoutMs = 60_000) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`模型接口 ${response.status}：${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

/** 让模型返回一段 JSON；不同兼容实现的能力不一样，这里做了降级重试 */
export async function chatJson({ system, user, temperature = 0.2 }) {
  const provider = resolveProvider();
  if (provider.name === 'none' || !provider.key) {
    throw new Error('未配置模型 key（LLM_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）');
  }
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const base = {
    model: provider.model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  let data;
  try {
    data = await post(url, { ...base, response_format: { type: 'json_object' } }, provider.key);
  } catch (error) {
    // 有的兼容实现不支持 response_format，退回纯文本再自己抠 JSON
    data = await post(url, base, provider.key);
  }

  const content = data?.choices?.[0]?.message?.content ?? '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('模型没有返回 JSON');
  }
  let parsed;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error('模型返回的 JSON 无法解析');
  }
  return {
    data: parsed,
    model: provider.model,
    provider: provider.name,
    usage: data?.usage ?? null,
  };
}

export function describeProvider() {
  const provider = resolveProvider();
  return {
    name: provider.name,
    model: provider.model,
    ready: provider.name !== 'none' && Boolean(provider.key),
  };
}
