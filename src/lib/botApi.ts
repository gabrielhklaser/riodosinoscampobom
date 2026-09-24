export const BOT_USERNAME = 'defesacivilcampobom_bot';
const TOKEN_KEY = 'cb-admin-token';

export interface BotThreshold {
  id: string;
  name: string;
  meters: number;
  message: string;
  enabled: boolean;
  builtin?: boolean;
  /** distância (m) ANTES da cota que dispara o pré-aviso; 0 = desativado */
  preWarningM?: number;
  /** mensagem do pré-aviso (mesmos placeholders; {pre} = cota do pré-aviso) */
  preWarningMessage?: string;
  /** pré-aviso apenas quando o rio está SUBINDO (default: true) */
  preWarningOnlyRise?: boolean;
}

/** Tendência da curva — decide se o aviso é de subida ou de descida. */
export interface BotTrend {
  dir: 'subida' | 'descida' | 'estavel' | 'indefinida';
  rateCmH: number | null;
  deltaM: number | null;
  spanMin: number | null;
  n: number;
}

/** Rótulos da tendência (usados no painel). */
export const TREND_LABEL: Record<BotTrend['dir'], { texto: string; seta: string }> = {
  subida: { texto: 'Subida', seta: '↑' },
  descida: { texto: 'Descida', seta: '↓' },
  estavel: { texto: 'Estável', seta: '→' },
  indefinida: { texto: 'Indefinida', seta: '·' },
};

export interface BotSubscriber {
  chatId: number | string;
  name: string;
  username: string | null;
  since: number;
  active: boolean;
}

export interface BotLogEntry {
  ts: number;
  thresholdId: string;
  name: string;
  meters: number;
  level: number;
  chats: number;
  ok: boolean;
  reason?: string;
  /** direção da curva no momento do disparo (null em stores antigos) */
  direction?: string | null;
  rateCmH?: number | null;
  error?: string | null;
}

export interface BotConfig {
  bot: {
    username: string;
    ok: boolean;
    title: string;
    lastError: string | null;
    link: string;
    lastChecked?: number | null;
    lastSuccess?: number | null;
    consecutiveFails?: number;
    id?: number | null;
  };
  thresholds: BotThreshold[];
  subscribers: BotSubscriber[];
  lastReading: { level: number; ts: number; flow: number | null; rain?: number | null; source?: string } | null;
  /** tendência atual (subida/descida) calculada pelo servidor */
  trend?: BotTrend;
  fired: Record<string, { ts: number; level: number }>;
  log: BotLogEntry[];
  telegramToken?: string;
  outboxCount?: number;
}

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setBotToken(value: string) {
  sessionStorage.setItem(TOKEN_KEY, value);
}

export function clearBotToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Disparado quando o servidor recusa o token (401): o App faz logout automático. */
export const UNAUTHORIZED_EVENT = 'cb-admin:unauthorized';

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (auth) {
    const t = token();
    if (t) headers.set('Authorization', `Bearer ${t}`);
  }
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (auth && res.status === 401) {
      // token expirado/inválido: limpa e avisa o App para fechar o painel
      clearBotToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export async function loginBot(user: string, pass: string) {
  const data = await request<{ ok: boolean; token: string }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ user, pass }) },
    false,
  );
  if (data.token) setBotToken(data.token);
  return data;
}

export function reportRiverReading(reading: {
  level: number;
  ts: number;
  flow: number | null;
  rain?: number | null;
}) {
  return request('/api/bot/reading', { method: 'POST', body: JSON.stringify(reading) }, false).catch(
    () => undefined,
  );
}

export function fetchBotConfig() {
  return request<BotConfig & { ok: boolean }>('/api/bot/config');
}

export function verifyBot() {
  return request<BotConfig & { ok: boolean }>('/api/bot/verify', { method: 'POST' });
}

export function createThreshold(
  input: Partial<BotThreshold> & { name: string; meters: number; message: string },
) {
  return request<BotConfig & { ok: boolean; id: string }>('/api/bot/thresholds', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateThreshold(id: string, patch: Partial<BotThreshold>) {
  return request<BotConfig & { ok: boolean }>(`/api/bot/thresholds/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteThreshold(id: string) {
  return request<BotConfig & { ok: boolean }>(`/api/bot/thresholds/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function testThreshold(thresholdId: string, pre = false) {
  return request<BotConfig & { ok: boolean; entry: BotLogEntry }>('/api/bot/test', {
    method: 'POST',
    body: JSON.stringify({ thresholdId, pre }),
  });
}

export function addSubscriber(chatId: string, name?: string) {
  return request<BotConfig & { ok: boolean }>('/api/bot/subscribers', {
    method: 'POST',
    body: JSON.stringify({ chatId, name }),
  });
}

export function removeSubscriber(chatId: string | number) {
  return request<BotConfig & { ok: boolean }>(`/api/bot/subscribers/${encodeURIComponent(String(chatId))}`, {
    method: 'DELETE',
  });
}
