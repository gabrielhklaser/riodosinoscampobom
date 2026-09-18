/**
 * Ponte com a API do Telegram a partir do navegador.
 * O servidor do preview não consegue abrir TLS com api.telegram.org;
 * o browser do usuário consegue — via GET simples (envio) e proxies CORS (leitura).
 */

export const BOT_USERNAME = 'defesacivilcampobom_bot';
export const BOT_LINK = `https://t.me/${BOT_USERNAME}`;
export const BOT_START_LINK = `https://t.me/${BOT_USERNAME}?start=alerta`;

const PROXIES: { name: string; build: (url: string) => string; json?: boolean }[] = [
  { name: 'direto', build: (u) => u },
  { name: 'corsproxy', build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { name: 'allorigins-raw', build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: 'allorigins', build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: true },
  { name: 'codetabs', build: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
];

function apiUrl(token: string, method: string, params?: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      qs.set(k, String(v));
    }
  }
  const q = qs.toString();
  return `https://api.telegram.org/bot${token}/${method}${q ? `?${q}` : ''}`;
}

async function fetchJson(url: string, timeoutMs = 20000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text) throw new Error('resposta vazia');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('JSON inválido');
    }
  } finally {
    clearTimeout(t);
  }
}

async function telegramGet(token: string, method: string, params?: Record<string, string | number | undefined>) {
  const url = apiUrl(token, method, params);
  let lastErr: unknown = null;
  for (const proxy of PROXIES) {
    try {
      const raw = await fetchJson(proxy.build(url));
      const data = proxy.json ? (raw as { contents?: string }).contents : raw;
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (!parsed?.ok) throw new Error(parsed?.description || 'Telegram recusou');
      return parsed.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('falha ao falar com o Telegram');
}

/** Envio: GET simples sai do navegador mesmo com CORS (a API processa; a leitura da resposta é opcional). */
export async function telegramSend(token: string, chatId: string | number, text: string) {
  const url = apiUrl(token, 'sendMessage', {
    chat_id: String(chatId),
    text,
    disable_web_page_preview: 'true',
  });
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store' });
  } catch {
    /* tenta via proxy em seguida */
  }
  try {
    await telegramGet(token, 'sendMessage', {
      chat_id: String(chatId),
      text,
      disable_web_page_preview: 'true',
    });
    return true;
  } catch {
    return true;
  }
}

export async function telegramGetMe(token: string) {
  return telegramGet(token, 'getMe') as Promise<{ id: number; username?: string; first_name?: string }>;
}

export async function telegramGetUpdates(token: string, offset = 0) {
  return telegramGet(token, 'getUpdates', {
    offset: offset || undefined,
    timeout: 0,
    allowed_updates: JSON.stringify(['message']),
  }) as Promise<Array<{ update_id: number; message?: TelegramMessage }>>;
}

export async function telegramSetWebhook(token: string, url: string) {
  const hook = apiUrl(token, 'setWebhook', {
    url,
    drop_pending_updates: 'false',
    allowed_updates: JSON.stringify(['message']),
  });
  try {
    await fetch(hook, { mode: 'no-cors', cache: 'no-store' });
  } catch {
    /* ignore */
  }
  try {
    await telegramGet(token, 'setWebhook', {
      url,
      drop_pending_updates: 'false',
      allowed_updates: JSON.stringify(['message']),
    });
  } catch {
    /* o no-cors já pode ter registrado */
  }
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number; title?: string; type?: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
}

export function parseChatId(raw: string) {
  const cleaned = String(raw || '').trim().replace(/[^\d-]/g, '');
  if (!/^-?\d{3,20}$/.test(cleaned)) {
    throw new Error('Chat ID inválido. Use só números, sem vírgula — ex.: 6810701338');
  }
  return cleaned;
}
