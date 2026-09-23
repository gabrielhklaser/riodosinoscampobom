/**
 * API do painel técnico + bot Telegram @defesacivilcampobom_bot
 * Token via TELEGRAM_BOT_TOKEN (variável de ambiente).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(join(__dirname, '..', '.env'));

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
// SEM fallback: sem senha no .env o servidor não sobe (o token de admin é
// derivado dela — default público seria explorável por qualquer um).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// SEM fallback com token real em código: o antigo token estava commitado
// num repositório público e deve ser considerado vazado (rodar /revoke no
// BotFather). Defina o token novo no .env.
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || 'defesacivilcampobom_bot').replace(
  /^@/,
  '',
);

const DATA_DIR = join(__dirname, 'data');
const STORE_FILE = join(DATA_DIR, 'bot-config.json');
const DIST_DIR = join(__dirname, '..', 'dist');
const TG = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_WEBHOOK_URL = (process.env.TELEGRAM_WEBHOOK_URL || '').trim();
// Fallback de emergência: permite que o navegador do admin converse direto
// com o Telegram (e, com isso, o /api/bot/config expõe o token para
// administradores). Mantenha DESLIGADO em produção.
const EXPOSE_BROWSER_BRIDGE = process.env.TELEGRAM_BROWSER_BRIDGE === '1';

/* ------------------------ checagem de credenciais ------------------------ */
const missingEnv = [];
if (!ADMIN_PASSWORD) missingEnv.push('ADMIN_PASSWORD');
if (!TELEGRAM_BOT_TOKEN) missingEnv.push('TELEGRAM_BOT_TOKEN');
if (missingEnv.length) {
  console.error(`[setup] Variável(is) ausente(s) no .env: ${missingEnv.join(', ')}.`);
  console.error('[setup] O servidor não inicia sem credenciais. Copie .env.example para .env e preencha:');
  console.error('  TELEGRAM_BOT_TOKEN = token do BotFather (https://t.me/BotFather → /token)');
  console.error('  ADMIN_PASSWORD     = senha forte do painel técnico');
  console.error('[setup] Importante: credenciais antigas já foram publicadas no repositório —');
  console.error('gere um token novo no BotFather (/revoke) e use uma senha nova.');
  process.exit(1);
}

const ANA_CODE = '87380000';
const ANA_URL = 'https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos';

/* ------------------- INMET: avisos meteorológicos (proxy+cache) -------------------
 * Fonte oficial: https://apiprevmet3.inmet.gov.br/avisos/ativos  (JSON público,
 * sem chave). O endpoint antigo dos tutoriais (apitempo.inmet.gov.br/avisos/ativos)
 * não existe mais — use apiprevmet3.
 *
 * Resiliência: timeout de 5 s, cache em memória com TTL de 12 min (a API do
 * INMET não muda segundo a segundo e consultas diretas de muitos navegadores
 * podem travar a instância do Render). Se a INMET estiver fora do ar, o
 * painel NÃO quebra: devolvemos a última lista válida com fallback=true,
 * ou lista vazia se ainda não houver nada em cache.
 *
 * INMET_API_URL e INMET_CACHE_TTL_MS podem ser sobrescritas por env
 * (útil em testes/staging).
 */
const INMET_URL = (process.env.INMET_API_URL || 'https://apiprevmet3.inmet.gov.br/avisos/ativos').trim();
const INMET_CACHE_TTL_MS = Number(process.env.INMET_CACHE_TTL_MS || 12 * 60 * 1000);
const INMET_TIMEOUT_MS = 5000;
// Centro de Campo Bom/RS (ponto de referência para o fallback de polígono)
const CAMPO_BOM = { nome: 'Campo Bom', uf: 'RS', codigoIbge: '4303905', lat: -29.4322, lon: -51.3506 };

const SEVERIDADE_RANK = { amarelo: 1, laranja: 2, vermelho: 3 };

function normalizarSeveridade(aviso) {
  // Aceita os rótulos em pt-BR ("Perigo Potencial"/"Perigo"/"Grande Perigo"),
  // em inglês ("Moderate"/"Severe"/"Extreme") e a cor do aviso. "Perigo
  // Potencial" tem de ser testado ANTES de "Perigo" (o substring engana).
  const cor = String(aviso.aviso_cor || '').toLowerCase();
  const sev = String(aviso.severidade || '').toLowerCase();
  const s = `${sev} ${cor}`;
  if (!s.trim()) return 'amarelo';
  if (/(grande perigo|extreme|vermelho|\bred\b)/.test(s)) return 'vermelho';
  if (/(perigo potencial|potencial|moderate|amarelo|\byellow\b|aten[cç][aã]o)/.test(s)) return 'amarelo';
  if (/(perigo|severe|laranja|orange)/.test(s)) return 'laranja';
  return 'amarelo'; // rótulo desconhecido: segue o mais brando, mas o texto original vai no card
}

// Ray casting: o ponto (lon/lat) está dentro do anel externo do polígono?
function pontoNoAnel(lon, lat, anel) {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const xi = anel[i][0], yi = anel[i][1];
    const xj = anel[j][0], yj = anel[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function pontoNoPoligono(aviso) {
  let g = aviso.poligono;
  if (typeof g === 'string') {
    try {
      g = JSON.parse(g);
    } catch {
      return false;
    }
  }
  if (!g || typeof g !== 'object') return false;
  const polys =
    g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : null;
  if (!Array.isArray(polys)) return false;
  for (const poly of polys) {
    const anel = Array.isArray(poly?.[0]) ? poly[0] : null;
    if (anel && anel.length > 2 && pontoNoAnel(CAMPO_BOM.lon, CAMPO_BOM.lat, anel)) return true;
  }
  return false;
}

// O aviso cobre Campo Bom? Ordem: lista explícita de geocodes → lista de
// municípios ("Nome - UF (IBGE)", confiável inclusive no negativo) →
// fallback geoespacial (polígono), só quando a lista não existe.
function cobreCampoBom(aviso) {
  const COD = CAMPO_BOM.codigoIbge;
  if (typeof aviso.geocodes === 'string') {
    if (aviso.geocodes.split(',').map((s) => s.trim()).includes(COD)) return true;
  }
  if (typeof aviso.municipios === 'string' && aviso.municipios.trim()) {
    for (const parte of aviso.municipios.split(',')) {
      const m = parte.match(/\((\d{7})\)\s*$/);
      if (m && m[1] === COD) return true;
      if (new RegExp(`^${CAMPO_BOM.nome} - ${CAMPO_BOM.uf}\\b`, 'i').test(parte.trim())) return true;
    }
    return false; // a lista existe e a cidade não está nela
  }
  return pontoNoPoligono(aviso);
}

// data_inicio vem como "2026-09-21T00:00:00.000Z" (data local, relógio
// zerado) e hora_inicio como "09:03" (horário local de Brasília, UTC-3,
// sem horário de verão desde 2019). Compomos o wall-clock local num epoch.
function inmetEpoch(dataStr, horaStr) {
  const d = String(dataStr || '').slice(0, 10);
  const [y, mo, dia] = d.split('-').map(Number);
  const [hh, mm] = String(horaStr || '00:00').split(':').map(Number);
  if (!y || !mo || !dia) return null;
  const t = Date.UTC(y, mo - 1, dia, hh || 0, mm || 0) + 3 * 3600 * 1000;
  return new Date(t).toISOString();
}

function parseInmetAviso(raw, periodo) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id) : raw.codigo != null ? String(raw.codigo) : null;
  const descricao = String(raw.descricao || '').trim();
  if (!id || !descricao) return null;
  const inicio =
    raw.inicio != null ? String(raw.inicio) : inmetEpoch(raw.data_inicio, raw.hora_inicio);
  const fim =
    raw.fim != null ? String(raw.fim) : inmetEpoch(raw.data_fim, raw.hora_fim);
  const riscos = Array.isArray(raw.riscos)
    ? raw.riscos.map((r) => String(r || '').trim()).filter(Boolean)
    : [];
  const instrucoes = Array.isArray(raw.instrucoes)
    ? raw.instrucoes.map((r) => String(r || '').trim()).filter(Boolean)
    : [];
  return {
    id,
    // "Aviso de Chuvas Intensas" → "Chuvas Intensas"
    tipo: descricao.replace(/^aviso\s+de\s+/i, '').replace(/\.$/, '').trim() || descricao,
    severidade: normalizarSeveridade(raw),
    severidadeOriginal: raw.severidade != null ? String(raw.severidade) : null,
    periodo, // 'hoje' (vigente) | 'futuro' (publicado, inicia depois)
    inicio: inicio || null,
    fim: fim || null,
    riscos,
    instrucoes,
  };
}

let inmetCache = { avisos: null, ts: 0 };

async function buscarAvisosInmet() {
  const now = Date.now();
  if (inmetCache.avisos && now - inmetCache.ts < INMET_CACHE_TTL_MS) {
    return { avisos: inmetCache.avisos, atualizadoEm: inmetCache.ts, fallback: false };
  }
  try {
    const resp = await fetch(INMET_URL, {
      signal: AbortSignal.timeout(INMET_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'CampoBomMonitor/1.0 (painel rio dos sinos)' },
    });
    if (!resp.ok) throw new Error(`INMET respondeu HTTP ${resp.status}`);
    const payload = await resp.json();
    if (!payload || typeof payload !== 'object') throw new Error('INMET retornou payload inválido');

    const buckets = [
      ['hoje', Array.isArray(payload.hoje) ? payload.hoje : []],
      ['futuro', Array.isArray(payload.futuro) ? payload.futuro : []],
    ];
    // Revisões do mesmo aviso (id_aviso + id_sequencia): mantém a última.
    const porAviso = new Map();
    for (const [periodo, lista] of buckets) {
      for (const raw of lista) {
        if (!raw || typeof raw !== 'object') continue;
        const key = String(raw.id_aviso ?? raw.id ?? raw.codigo ?? Math.random());
        const seq = Number(raw.id_sequencia ?? 0);
        const prev = porAviso.get(key);
        if (!prev || seq >= Number(prev.id_sequencia ?? 0)) porAviso.set(key, { ...raw, __periodo: periodo });
      }
    }
    const avisos = [];
    for (const raw of porAviso.values()) {
      if (!cobreCampoBom(raw)) continue;
      const m = parseInmetAviso(raw, raw.__periodo);
      if (m) avisos.push(m);
    }
    avisos.sort(
      (a, b) =>
        (SEVERIDADE_RANK[b.severidade] - SEVERIDADE_RANK[a.severidade]) ||
        String(a.inicio || '').localeCompare(String(b.inicio || '')),
    );
    inmetCache = { avisos, ts: now };
    return { avisos, atualizadoEm: now, fallback: false };
  } catch (err) {
    // INMET fora do ar: última lista válida (com fallback=true) ou vazia.
    if (inmetCache.avisos) {
      return { avisos: inmetCache.avisos, atualizadoEm: inmetCache.ts, fallback: true };
    }
    console.error(`[inmet] indisponível: ${err?.message || err}`);
    return { avisos: [], atualizadoEm: null, fallback: true };
  }
}

const DEFAULT_THRESHOLDS = [
  {
    id: 'atencao',
    name: 'Atenção',
    meters: 6.2,
    enabled: true,
    builtin: true,
    message:
      '⚠️ ATENÇÃO — Defesa Civil de Campo Bom\n\nO Rio dos Sinos atingiu a cota de Atenção.\nNível atual: {nivel} m (cota: {cota} m).\nHorário: {hora}\n\nEvite áreas ribeirinhas e acompanhe os boletins oficiais.\nDefesa Civil: (51) 3597-3683',
    preWarningM: 0.3,
    preWarningMessage:
      '🟡 PRÉ-AVISO — Defesa Civil de Campo Bom\n\nO Rio dos Sinos está se aproximando do nível de Atenção ({cota} m).\nNível atual: {nivel} m (referência do pré-aviso: {pre} m).\nHorário: {hora}\n\nMantenha atenção e acompanhe os boletins oficiais.\nDefesa Civil: (51) 3597-3683',
  },
  {
    id: 'alerta',
    name: 'Alerta',
    meters: 6.7,
    enabled: true,
    builtin: true,
    message:
      '🟠 ALERTA — Defesa Civil de Campo Bom\n\nO Rio dos Sinos atingiu a cota de Alerta.\nNível atual: {nivel} m (cota: {cota} m).\nHorário: {hora}\n\nProcure um local elevado, retire documentos das áreas baixas e afaste-se da margem.\nDefesa Civil: (51) 3597-3683 · 199',
    preWarningM: 0.3,
    preWarningMessage:
      '🟠 PRÉ-AVISO — Defesa Civil de Campo Bom\n\nO Rio dos Sinos está se aproximando do nível de Alerta ({cota} m).\nNível atual: {nivel} m (referência do pré-aviso: {pre} m).\nHorário: {hora}\n\nPrepare-se: identifique rotas de fuga e mantenha documentos acessíveis.\nDefesa Civil: (51) 3597-3683 · 199',
  },
  {
    id: 'inundacao',
    name: 'Inundação',
    meters: 7.2,
    enabled: true,
    builtin: true,
    message:
      '🔴 INUNDAÇÃO — Defesa Civil de Campo Bom\n\nO Rio dos Sinos atingiu a cota de Inundação.\nNível atual: {nivel} m (cota: {cota} m).\nHorário: {hora}\n\nDirija-se imediatamente a um abrigo seguro. Não atravesse trechos alagados.\nDefesa Civil: (51) 3597-3683 · 199 · Bombeiros 193',
    preWarningM: 0.3,
    preWarningMessage:
      '🔴 PRÉ-AVISO — Defesa Civil de Campo Bom\n\nO Rio dos Sinos está se aproximando do nível de Inundação ({cota} m).\nNível atual: {nivel} m (referência do pré-aviso: {pre} m).\nHorário: {hora}\n\nResidentes de áreas de risco: preparem-se para deixar a área. Não atravesse a margem.\nDefesa Civil: (51) 3597-3683 · 199 · Bombeiros 193',
  },
];

/* ------------------------------------------------------------------ */
/* Persistência                                                        */
/* ------------------------------------------------------------------ */

function emptyStore() {
  return {
    thresholds: DEFAULT_THRESHOLDS.map((t) => ({ ...t })),
    subscribers: [],
    fired: {},
    lastReading: null,
    log: [],
    outbox: [],
    bot: {
      username: TELEGRAM_BOT_USERNAME,
      ok: false,
      title: '',
      lastError: null,
      id: null,
      lastChecked: null,
      lastSuccess: null,
      consecutiveFails: 0,
    },
    updateOffset: 0,
  };
}

function loadStore() {
  try {
    if (!existsSync(STORE_FILE)) return emptyStore();
    const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
    const base = emptyStore();
    return {
      ...base,
      ...raw,
      // garante os campos de pré-alerta (migração de stores antigos)
      thresholds: (Array.isArray(raw.thresholds) && raw.thresholds.length ? raw.thresholds : base.thresholds).map((t) => {
        const d = base.thresholds.find((x) => x.id === t.id);
        return {
          ...t,
          preWarningM: t.preWarningM != null ? Number(t.preWarningM) || 0 : d ? d.preWarningM : 0,
          preWarningMessage: t.preWarningMessage != null ? String(t.preWarningMessage) : d ? d.preWarningMessage : '',
        };
      }),
      subscribers: Array.isArray(raw.subscribers) ? raw.subscribers : [],
      fired: raw.fired && typeof raw.fired === 'object' ? raw.fired : {},
      log: Array.isArray(raw.log) ? raw.log.slice(-80) : [],
      outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
      bot: {
        ...base.bot,
        ...(raw.bot || {}),
        username: (raw.bot && raw.bot.username) || base.bot.username,
        ok: !!(raw.bot && raw.bot.ok),
        lastChecked: (raw.bot && raw.bot.lastChecked) || null,
        lastSuccess: (raw.bot && raw.bot.lastSuccess) || null,
        consecutiveFails: Number((raw.bot && raw.bot.consecutiveFails) || 0),
      },
    };
  } catch {
    return emptyStore();
  }
}

function saveStore() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, STORE_FILE);
}

function parseChatId(raw) {
  const cleaned = String(raw || '').trim().replace(/[^\d-]/g, '');
  if (!/^-?\d{3,20}$/.test(cleaned)) {
    throw new Error('Chat ID inválido. Use só números, sem vírgula — ex.: 6810701338');
  }
  return cleaned;
}

function enqueueOutbox(chatId, text) {
  if (!Array.isArray(store.outbox)) store.outbox = [];
  store.outbox.push({
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    chatId: String(chatId),
    text,
    ts: Date.now(),
  });
  store.outbox = store.outbox.slice(-200);
  saveStore();
}

function ensureAdminSubscriber() {
  const id = '6810701338';
  if (store.subscribers.some((s) => String(s.chatId) === id)) return;
  store.subscribers.push({
    chatId: id,
    name: 'Administrador',
    username: null,
    since: Date.now(),
    active: true,
  });
  enqueueOutbox(
    id,
    'Inscrição confirmada.\nVocê receberá os alertas de cota do Rio dos Sinos em Campo Bom.\n\nAbra @defesacivilcampobom_bot e envie /start para confirmar. Comandos: /nivel /stop /ajuda',
  );
}

let store = loadStore();
ensureAdminSubscriber();

/** limite de taxa do POST /api/bot/reading (1 por 60 s, global) */
let lastReadingPushAt = 0;

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
/* Token de admin: HMAC-SHA256 assinado com a ADMIN_PASSWORD (que nunca
 * sai do servidor) + data de expiração. Substitui o esquema antigo
 * (base64 determinístico da senha, sem validade): agora o token expira
 * sozinho e não permite reconstruir a senha a partir dele.
 * ADMIN_TOKEN_TTL_HOURS controla a validade (padrão 24 h). */
const ADMIN_TOKEN_TTL_MS =
  Math.max(1, Number(process.env.ADMIN_TOKEN_TTL_HOURS || 24)) * 3600 * 1000;
const TOKEN_PEPPER = 'defesacivil-campobom:v2';

function signTokenPayload(payload) {
  return createHmac('sha256', ADMIN_PASSWORD).update(`${TOKEN_PEPPER}:${payload}`).digest('base64url');
}

function issueAdminToken() {
  const exp = Date.now() + ADMIN_TOKEN_TTL_MS;
  const payload = `admin.${exp}.${randomBytes(8).toString('hex')}`;
  return { token: `${payload}.${signTokenPayload(payload)}`, expiresAt: exp };
}

function verifyAdminToken(token) {
  if (typeof token !== 'string' || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [role, expRaw, , sig] = parts;
  const payload = parts.slice(0, 3).join('.');
  if (role !== 'admin') return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  return safeEqualStr(sig, signTokenPayload(payload));
}

/** Comparação em tempo constante (evita timing attack em senha/token). */
function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function isAuthorized(req) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return verifyAdminToken(bearer);
}

/* Bloqueio anti-força-bruta no login: após LOGIN_MAX_FAILS tentativas
 * erradas, o IP fica bloqueado por LOGIN_LOCK_MS. Sem isso, a senha do
 * painel poderia ser atacada por dicionário indefinidamente. */
const LOGIN_MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 8);
const LOGIN_LOCK_MS = Number(process.env.LOGIN_LOCK_MS || 15 * 60 * 1000);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
/** @type {Map<string, { fails: number; firstFail: number; lockedUntil: number }>} */
const loginAttempts = new Map();

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'desconhecido';
}

function loginBlocked(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return 0;
  if (rec.lockedUntil > Date.now()) return rec.lockedUntil - Date.now();
  if (Date.now() - rec.firstFail > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  return 0;
}

function registerLoginFailure(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.firstFail > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { fails: 1, firstFail: now, lockedUntil: 0 });
    return;
  }
  rec.fails += 1;
  if (rec.fails >= LOGIN_MAX_FAILS) {
    rec.lockedUntil = now + LOGIN_LOCK_MS;
    rec.fails = 0;
    rec.firstFail = now;
  }
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

// faxina periódica do mapa de tentativas (evita crescimento sem limite)
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) {
    if (rec.lockedUntil <= now && now - rec.firstFail > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  }
}, 60 * 1000).unref?.();

/* ------------------------------------------------------------------ */
/* Telegram                                                            */
/* ------------------------------------------------------------------ */

async function tg(method, payload) {
  const res = await fetch(`${TG}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const desc = data.description || `HTTP ${res.status}`;
    const authFail = /unauthorized|forbidden|invalid token/i.test(desc) || res.status === 401 || res.status === 403;
    const err = new Error(desc);
    err.code = authFail ? 'AUTH' : 'TRANSIENT';
    err.status = res.status;
    throw err;
  }
  return data.result;
}

async function sendTelegram(chatId, text) {
  try {
    return await tg('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  } catch (err) {
    enqueueOutbox(chatId, text);
    throw err;
  }
}

function interpolate(template, reading, threshold, preM = 0) {
  const hora = reading.ts
    ? new Date(reading.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const nivel = Number(reading.level).toFixed(2).replace('.', ',');
  const cota = Number(threshold.meters).toFixed(2).replace('.', ',');
  const pre = Number(threshold.meters - preM).toFixed(2).replace('.', ',');
  const vazao = reading.flow != null ? Number(reading.flow).toFixed(1).replace('.', ',') : '—';
  return String(template || '')
    .replaceAll('{nivel}', nivel)
    .replaceAll('{level}', nivel)
    .replaceAll('{cota}', cota)
    .replaceAll('{pre}', pre)
    .replaceAll('{nome}', threshold.name)
    .replaceAll('{hora}', hora)
    .replaceAll('{vazao}', vazao);
}

async function dispatchThreshold(threshold, reading, reason, preM = 0) {
  const isTest = reason === 'teste_manual';
  // Teste vai marcado: o texto real do alerta não pode ser indistinguível
  // de um teste — num evento real, um "teste" sem marca apaga a confiança
  // dos inscritos no alerta.
  const body = interpolate(threshold.message, reading, threshold, preM);
  const text = isTest
    ? `🧪 TESTE — não é um alerta real (mensagem do limite "${threshold.name}"${preM > 0 ? ' · pré-aviso' : ''}).\n\n${body}`
    : body;
  const targets = store.subscribers.filter((s) => s.active !== false);
  const results = [];

  if (!targets.length) {
    const entry = {
      ts: Date.now(),
      thresholdId: threshold.id,
      name: threshold.name,
      meters: threshold.meters,
      level: reading.level,
      chats: 0,
      ok: false,
      reason,
      error: 'Nenhum destinatário inscrito. Peça para a equipe iniciar o bot com /start.',
    };
    store.log.unshift(entry);
    store.log = store.log.slice(0, 80);
    saveStore();
    return entry;
  }

  for (const sub of targets) {
    try {
      await sendTelegram(sub.chatId, text);
      results.push({ chatId: sub.chatId, ok: true });
    } catch (err) {
      results.push({ chatId: sub.chatId, ok: false, error: err instanceof Error ? err.message : 'falha' });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const entry = {
    ts: Date.now(),
    thresholdId: threshold.id,
    name: threshold.name,
    meters: threshold.meters,
    level: reading.level,
    chats: okCount,
    ok: okCount > 0,
    reason,
    error: okCount ? null : results.map((r) => r.error).filter(Boolean).join('; ') || 'falha ao enviar',
  };
  store.log.unshift(entry);
  store.log = store.log.slice(0, 80);
  saveStore();
  return entry;
}

/**
 * Compara a leitura com os limites cadastrados.
 * Dispara ao cruzar um limite (subida). Recua o "fired" quando o nível
 * volta abaixo, para poder alertar de novo numa próxima cheia.
 */
async function evaluateReading(reading) {
  if (!reading || !Number.isFinite(reading.level)) {
    throw new Error('leitura inválida');
  }

  store.lastReading = {
    level: reading.level,
    ts: reading.ts || Date.now(),
    flow: reading.flow ?? null,
    rain: reading.rain ?? null,
    source: reading.source || 'painel',
  };

  const enabled = [...store.thresholds]
    .filter((t) => t.enabled !== false && Number.isFinite(Number(t.meters)))
    .sort((a, b) => a.meters - b.meters);

  const dispatched = [];

  for (const t of enabled) {
    const above = reading.level + 1e-9 >= Number(t.meters);

    // PRÉ-AVISO: dispara quando a leitura cruza (cota - pré-alerta),
    // enquanto o nível ainda está ABAIXO da cota principal. Se a leitura
    // pular direto para cima da cota, ganha o alerta principal (sem
    // pré-aviso duplo). Recua a marca quando o nível desce, para poder
    // avisar de novo se subir outra vez.
    const preM = Number(t.preWarningM) > 0 ? Number(t.preWarningM) : 0;
    if (preM > 0 && t.preWarningMessage && !above) {
      const preLevel = Number(t.meters) - preM;
      const preFired = store.fired[`${t.id}:pre`];
      if (reading.level + 1e-9 >= preLevel && !preFired) {
        store.fired[`${t.id}:pre`] = { ts: Date.now(), level: reading.level };
        saveStore();
        const entry = await dispatchThreshold({ ...t, message: t.preWarningMessage }, reading, 'pre_alerta', preM);
        dispatched.push(entry);
      } else if (reading.level < preLevel && preFired) {
        delete store.fired[`${t.id}:pre`];
      }
    }

    if (above && !store.fired[t.id]) {
      store.fired[t.id] = { ts: Date.now(), level: reading.level };
      saveStore();
      const entry = await dispatchThreshold(t, reading, 'cruzou_limite');
      dispatched.push(entry);
    } else if (!above && store.fired[t.id]) {
      delete store.fired[t.id];
      delete store.fired[`${t.id}:pre`];
    }
  }

  saveStore();
  return { reading: store.lastReading, dispatched };
}

/* ------------------------------------------------------------------ */
/* Comandos do bot                                                     */
/* ------------------------------------------------------------------ */

function helpText() {
  return (
    `Defesa Civil de Campo Bom — @${TELEGRAM_BOT_USERNAME}\n\n` +
    `Monitoramento do Rio dos Sinos (estação ANA ${ANA_CODE}).\n\n` +
    `Comandos:\n` +
    `/start — receber alertas de cota\n` +
    `/stop — cancelar alertas\n` +
    `/nivel — última leitura do rio\n` +
    `/ajuda — esta mensagem`
  );
}

function nivelText() {
  const r = store.lastReading;
  if (!r) return 'Ainda não há leitura recente do Rio dos Sinos.';
  const hora = new Date(r.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const n = Number(r.level).toFixed(2).replace('.', ',');
  const active = [...store.thresholds]
    .filter((t) => t.enabled !== false && r.level >= t.meters)
    .sort((a, b) => b.meters - a.meters)[0];
  const situacao = active ? active.name : 'Normal';
  return (
    `Rio dos Sinos — Campo Bom\n` +
    `Nível: ${n} m\n` +
    `Situação: ${situacao}\n` +
    `Horário: ${hora}` +
    (r.flow != null ? `\nVazão: ${Number(r.flow).toFixed(1).replace('.', ',')} m³/s` : '')
  );
}

function upsertSubscriber(from, chat) {
  const chatId = parseChatId(chat.id);
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || chat.title || String(chatId);
  const existing = store.subscribers.find((s) => String(s.chatId) === String(chatId));
  if (existing) {
    existing.active = true;
    existing.name = name;
    existing.username = from?.username || existing.username || null;
  } else {
    store.subscribers.push({
      chatId,
      name,
      username: from?.username || null,
      since: Date.now(),
      active: true,
    });
  }
  saveStore();
}

function commandReply(update) {
  const msg = update.message || update.edited_message;
  if (!msg?.text || !msg.chat) return null;
  const text = String(msg.text).trim();
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const chatId = msg.chat.id;

  if (cmd === '/start') {
    upsertSubscriber(msg.from, msg.chat);
    return {
      chatId,
      text: `Inscrição confirmada.\nVocê receberá os alertas de cota do Rio dos Sinos em Campo Bom.\n\n${helpText()}`,
    };
  }
  if (cmd === '/stop') {
    const sub = store.subscribers.find((s) => String(s.chatId) === String(chatId));
    if (sub) sub.active = false;
    saveStore();
    return { chatId, text: 'Alertas cancelados. Envie /start para voltar a receber.' };
  }
  if (cmd === '/nivel' || cmd === '/status') {
    return { chatId, text: nivelText() };
  }
  if (cmd === '/ajuda' || cmd === '/help') {
    return { chatId, text: helpText() };
  }
  return null;
}

async function handleUpdate(update) {
  const reply = commandReply(update);
  if (!reply) return [];
  try {
    await sendTelegram(reply.chatId, reply.text);
  } catch (err) {
    store.bot.lastError = err instanceof Error ? err.message : 'falha no comando';
    saveStore();
  }
  return [reply];
}

async function pollTelegram() {
  while (true) {
    try {
      const result = await tg('getUpdates', {
        offset: store.updateOffset || undefined,
        timeout: 25,
        allowed_updates: ['message'],
      });
      for (const upd of result || []) {
        store.updateOffset = upd.update_id + 1;
        await handleUpdate(upd);
      }
      store.bot.ok = true;
      store.bot.lastError = null;
      store.bot.lastChecked = Date.now();
      store.bot.lastSuccess = Date.now();
      store.bot.consecutiveFails = 0;
      saveStore();
    } catch (err) {
      const isAuth = err && err.code === 'AUTH';
      store.bot.lastChecked = Date.now();
      store.bot.consecutiveFails = (store.bot.consecutiveFails || 0) + 1;
      if (isAuth || store.bot.consecutiveFails >= 3) {
        store.bot.ok = false;
        store.bot.lastError = err instanceof Error ? err.message : 'falha no Telegram';
        saveStore();
      } else {
        store.bot.lastError = `transiente (`+store.bot.consecutiveFails+`/3): `+(err instanceof Error ? err.message : 'falha');
        saveStore();
      }
      await sleep(8000);
      continue;
    }
    await sleep(1500);
  }
}

async function verifyBot() {
  const now = Date.now();
  try {
    const me = await tg('getMe');
    store.bot.username = me.username || TELEGRAM_BOT_USERNAME;
    store.bot.title = me.first_name || 'Defesa Civil Campo Bom';
    store.bot.id = me.id;
    store.bot.ok = true;
    store.bot.lastError = null;
    store.bot.lastChecked = now;
    store.bot.lastSuccess = now;
    store.bot.consecutiveFails = 0;
    saveStore();
    console.log(`[bot] autenticado como @`+store.bot.username);
    return true;
  } catch (err) {
    const isAuth = err && err.code === 'AUTH';
    store.bot.lastChecked = now;
    store.bot.consecutiveFails = (store.bot.consecutiveFails || 0) + 1;
    if (isAuth || store.bot.consecutiveFails >= 3 || !store.bot.lastSuccess) {
      store.bot.ok = false;
    }
    store.bot.lastError = err instanceof Error ? err.message : 'token inválido';
    saveStore();
    console.error('[bot] falha ao autenticar:', store.bot.lastError);
    return false;
  }
}

/** Esvazia a fila quando o servidor consegue falar com o Telegram (VPS / produção). */
async function flushOutboxServer() {
  const pending = [...(store.outbox || [])];
  if (!pending.length) return;
  const sent = [];
  for (const msg of pending) {
    try {
      await tg('sendMessage', {
        chat_id: msg.chatId,
        text: msg.text,
        disable_web_page_preview: true,
      });
      sent.push(String(msg.id));
    } catch {
      break;
    }
  }
  if (sent.length) {
    const ids = new Set(sent);
    store.outbox = (store.outbox || []).filter((m) => !ids.has(String(m.id)));
    saveStore();
    console.log(`[bot] fila: ${sent.length} mensagem(ns) enviada(s)`);
  }
}

async function startBot() {
  const online = await verifyBot();
  if (TELEGRAM_WEBHOOK_URL) {
    try {
      await tg('setWebhook', {
        url: TELEGRAM_WEBHOOK_URL,
        allowed_updates: ['message'],
        drop_pending_updates: false,
      });
      console.log('[bot] webhook ativo:', TELEGRAM_WEBHOOK_URL);
    } catch (err) {
      console.error('[bot] falha ao registrar webhook:', err instanceof Error ? err.message : err);
      pollTelegram();
    }
  } else {
    try {
      await tg('deleteWebhook', { drop_pending_updates: false });
    } catch {
      /* sem webhook anterior */
    }
    pollTelegram();
    console.log('[bot] polling getUpdates iniciado');
  }
  if (online) await flushOutboxServer();
  pollAna();
  setInterval(() => {
    flushOutboxServer().catch(() => undefined);
  }, 15000);
  // reverificação periódica: se polling travou ou modo webhook sem tráfego, mantém lastChecked atualizado
  setInterval(() => {
    verifyBot().catch(() => undefined);
  }, 5 * 60 * 1000);
}

/* ------------------------------------------------------------------ */
/* Telemetria ANA (servidor, sem CORS)                                 */
/* ------------------------------------------------------------------ */

function pad(n) {
  return String(n).padStart(2, '0');
}
function brDate(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function parseAnaXml(xml) {
  const parts = xml.split(/<DataHora>/i);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const dateRaw = parts[i].match(/^([^<]+)/)?.[1]?.trim();
    const chunk = parts[i].slice(0, 1200);
    const nivelCm = Number(String(chunk.match(/<Nivel>([^<]*)<\/Nivel>/i)?.[1] || '').replace(',', '.'));
    if (!dateRaw || !Number.isFinite(nivelCm) || nivelCm <= 0) continue;
    const m = dateRaw.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) continue;
    const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    const flowRaw = chunk.match(/<Vazao>([^<]*)<\/Vazao>/i)?.[1];
    const rainRaw = chunk.match(/<Chuva>([^<]*)<\/Chuva>/i)?.[1];
    const flow = flowRaw ? Number(String(flowRaw).replace(',', '.')) : null;
    const rain = rainRaw ? Number(String(rainRaw).replace(',', '.')) : null;
    out.push({
      ts,
      level: +(nivelCm / 100).toFixed(2),
      flow: Number.isFinite(flow) ? flow : null,
      rain: Number.isFinite(rain) ? rain : null,
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.filter((r, i) => i === 0 || r.ts !== out[i - 1].ts);
}

async function fetchAnaLatest() {
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 86400000);
  const end = new Date(now.getTime() + 86400000);
  const url = `${ANA_URL}?codEstacao=${ANA_CODE}&dataInicio=${brDate(start)}&dataFim=${brDate(end)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ANA HTTP ${res.status}`);
  const xml = await res.text();
  const readings = parseAnaXml(xml);
  if (!readings.length) throw new Error('ANA sem registros');
  return readings[readings.length - 1];
}

async function pollAna() {
  while (true) {
    try {
      const last = await fetchAnaLatest();
      await evaluateReading({ ...last, source: 'ana' });
    } catch (err) {
      console.error('[ana]', err instanceof Error ? err.message : err);
    }
    await sleep(2 * 60 * 1000);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function publicConfig() {
  return {
    bot: {
      username: store.bot.username || TELEGRAM_BOT_USERNAME,
      ok: !!store.bot.ok,
      title: store.bot.title || '',
      lastError: store.bot.lastError,
      lastChecked: store.bot.lastChecked || null,
      lastSuccess: store.bot.lastSuccess || null,
      consecutiveFails: store.bot.consecutiveFails || 0,
      id: store.bot.id || null,
      link: `https://t.me/${store.bot.username || TELEGRAM_BOT_USERNAME}`,
    },
    thresholds: store.thresholds,
    subscribers: store.subscribers.map((s) => ({
      chatId: s.chatId,
      name: s.name,
      username: s.username || null,
      since: s.since,
      active: s.active !== false,
    })),
    lastReading: store.lastReading,
    fired: store.fired,
    log: store.log.slice(0, 40),
    // Nunca expor o token por padrão: quem tem o token controla o bot.
    // Só vai no payload quando TELEGRAM_BROWSER_BRIDGE=1 (fallback de emergência).
    telegramToken: EXPOSE_BROWSER_BRIDGE ? TELEGRAM_BOT_TOKEN : undefined,
    outboxCount: Array.isArray(store.outbox) ? store.outbox.length : 0,
    subscribeLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=alerta`,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('JSON inválido');
  }
}

function normalizeThreshold(input, fallback = {}) {
  const name = String(input.name ?? fallback.name ?? '').trim();
  const meters = Number(String(input.meters ?? fallback.meters ?? '').toString().replace(',', '.'));
  const message = String(input.message ?? fallback.message ?? '').trim();
  const enabled = input.enabled == null ? fallback.enabled !== false : !!input.enabled;
  // pré-alerta: distância (m) ANTES da cota; 0 = desativado
  const rawPre = input.preWarningM === '' || input.preWarningM == null ? fallback.preWarningM : input.preWarningM;
  const preWarningM = Number(String(rawPre ?? 0).replace(',', '.'));
  const preWarningMessage =
    input.preWarningMessage == null
      ? String(fallback.preWarningMessage ?? '')
      : String(input.preWarningMessage).trim();
  if (!name) throw new Error('informe o nome do limite');
  if (!Number.isFinite(meters) || meters <= 0 || meters > 30) throw new Error('cota inválida (metros)');
  if (!message) throw new Error('informe a mensagem do alerta');
  if (!Number.isFinite(preWarningM) || preWarningM < 0 || preWarningM > 5) {
    throw new Error('pré-alerta inválido (use 0 a 5 m antes da cota; 0 desativa)');
  }
  return { name, meters: +meters.toFixed(2), message, enabled, preWarningM: +preWarningM.toFixed(2), preWarningMessage };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve o build estático de DIST_DIR.
 *  - bloqueia path traversal (só arquivos DENTRO de DIST_DIR);
 *  - rota sem arquivo correspondente cai no index.html (SPA);
 *  - retorna true quando atendeu, false para 404.
 */
function serveStatic(req, res, pathname) {
  if (!existsSync(DIST_DIR)) return false;
  let name;
  try {
    name = decodeURIComponent(pathname || '/');
  } catch {
    return false;
  }
  const file = resolve(DIST_DIR, name.replace(/^\/+/, ''));
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + sep)) return false;

  let target = file;
  if (!existsSync(target) || statSync(target).isDirectory()) {
    const index = join(DIST_DIR, 'index.html');
    if (req.method === 'GET' && existsSync(index)) target = index;
    else return false;
  }

  const body = readFileSync(target);
  const isIndex = target === join(DIST_DIR, 'index.html');
  res.writeHead(200, {
    'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    // index.html sempre fresco (deploy novo); assets podem ficar em cache
    'Cache-Control': isIndex ? 'no-store' : 'public, max-age=3600',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (req.method === 'GET' && (path === '/api/health' || path === '/health')) {
      send(res, 200, {
        ok: true,
        bot: store.bot.username,
        online: !!store.bot.ok,
        lastChecked: store.bot.lastChecked || null,
        lastSuccess: store.bot.lastSuccess || null,
        consecutiveFails: store.bot.consecutiveFails || 0,
        lastError: store.bot.lastError || null,
        time: Date.now(),
      });
      return;
    }

    // Avisos meteorológicos do INMET para Campo Bom — PÚBLICO (o site é
    // aberto) e protegido por cache/TTL + timeout na busca upstream.
    if (req.method === 'GET' && path === '/api/alertas/campo-bom') {
      const r = await buscarAvisosInmet();
      send(res, 200, {
        ok: true,
        municipio: `${CAMPO_BOM.nome} - ${CAMPO_BOM.uf} (${CAMPO_BOM.codigoIbge})`,
        fonte: 'INMET — Instituto Nacional de Meteorologia',
        atualizadoEm: r.atualizadoEm,
        fallback: r.fallback,
        avisos: r.avisos,
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/telegram/webhook') {
      // secret_token (Telegram só envia updates para um webhook configurado
      // com o mesmo segredo) — evita que qualquer pessoa que saiba da URL
      // injete "updates" falsos (spam para chats arbitrários + poluição da
      // lista de inscritos). Só exigido quando o bridge do navegador está
      // desligado — o bridge registra o webhook sem segredo.
      const expectedSecret = (() => {
        try {
          return new URL(TELEGRAM_WEBHOOK_URL).searchParams.get('secret_token') || '';
        } catch {
          return '';
        }
      })();
      if (!EXPOSE_BROWSER_BRIDGE && expectedSecret && url.searchParams.get('secret_token') !== expectedSecret) {
        send(res, 403, { ok: false, error: 'secret_token inválido' });
        return;
      }
      const body = await readBody(req);
      // update bem-formado: update_id inteiro crescente (o Telegram é a
      // única fonte legítima de updates válidos)
      if (!Number.isInteger(body?.update_id) || body.update_id <= 0) {
        send(res, 400, { ok: false, error: 'update inválido' });
        return;
      }
      const reply = commandReply(body);
      store.bot.lastChecked = Date.now();
      store.bot.lastSuccess = Date.now();
      store.bot.consecutiveFails = 0;
      store.bot.ok = true;
      store.bot.lastError = null;
      saveStore();
      if (reply) {
        send(res, 200, {
          method: 'sendMessage',
          chat_id: reply.chatId,
          text: reply.text,
          disable_web_page_preview: true,
        });
      } else {
        send(res, 200, { ok: true });
      }
      return;
    }

    if (req.method === 'POST' && path === '/api/auth/login') {
      const ip = clientIp(req);
      const blockedMs = loginBlocked(ip);
      if (blockedMs > 0) {
        res.writeHead(429, {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': String(Math.ceil(blockedMs / 1000)),
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify({
            ok: false,
            error: `Muitas tentativas — aguarde ${Math.ceil(blockedMs / 60000)} min.`,
          }),
        );
        return;
      }
      const body = await readBody(req);
      const userOk = safeEqualStr(String(body.user ?? ''), ADMIN_USER);
      const passOk = safeEqualStr(String(body.pass ?? ''), ADMIN_PASSWORD);
      if (userOk && passOk) {
        clearLoginFailures(ip);
        const { token, expiresAt } = issueAdminToken();
        send(res, 200, { ok: true, token, expiresAt });
      } else {
        registerLoginFailure(ip);
        console.warn(`[auth] login recusado (ip=${ip})`);
        send(res, 401, { ok: false, error: 'Usuário ou senha incorretos.' });
      }
      return;
    }

    /* leitura pública: o painel envia o nível atual para o bot avaliar.
     * Endpoint sem autenticação (o painel público é anônimo), então aplica
     * limite de taxa e sanidade: sem isso qualquer um poderia disparar
     * alertas de enchente falsos para todos os inscritos. */
    if (req.method === 'POST' && path === '/api/bot/reading') {
      const body = await readBody(req);
      const level = Number(String(body.level ?? '').toString().replace(',', '.'));
      const nowMs = Date.now();
      if (nowMs - lastReadingPushAt < 60000) {
        send(res, 429, { ok: false, error: 'envio frequente demais — aguarde 60 s' });
        return;
      }
      if (!Number.isFinite(level) || level < 0.5 || level > 12) {
        send(res, 400, { ok: false, error: 'nível fora da faixa plausível (0,5–12 m)' });
        return;
      }
      const last = store.lastReading;
      if (last && Number.isFinite(last.level) && Math.abs(level - last.level) > 2.0) {
        send(res, 400, { ok: false, error: 'salto de nível improvável (±2 m) — leitura ignorada' });
        return;
      }
      lastReadingPushAt = nowMs;
      const result = await evaluateReading({
        level,
        ts: body.ts || Date.now(),
        flow: body.flow ?? null,
        rain: body.rain ?? null,
        source: body.source || 'painel',
      });
      send(res, 200, { ok: true, ...result });
      return;
    }

    const isApi = path.startsWith('/api/');
    if (isApi && !isAuthorized(req)) {
      send(res, 401, { ok: false, error: 'Não autorizado.' });
      return;
    }

    if (!isApi) {
      if (serveStatic(req, res, url.pathname)) return;
      send(res, 404, { ok: false, error: 'não encontrado' });
      return;
    }

    if (req.method === 'GET' && path === '/api/bot/config') {
      send(res, 200, { ok: true, ...publicConfig() });
      return;
    }

    if ((req.method === 'POST' || req.method === 'GET') && path === '/api/bot/verify') {
      try {
        await verifyBot();
      } catch {}
      send(res, 200, { ok: true, ...publicConfig() });
      return;
    }

    if (req.method === 'PUT' && path === '/api/bot/thresholds') {
      const body = await readBody(req);
      const list = Array.isArray(body.thresholds) ? body.thresholds : null;
      if (!list) throw new Error('lista de limites ausente');
      store.thresholds = list.map((t, i) => {
        const n = normalizeThreshold(t, t);
        return {
          id: String(t.id || `limite-${i + 1}`),
          builtin: !!t.builtin,
          ...n,
        };
      });
      saveStore();
      send(res, 200, { ok: true, ...publicConfig() });
      return;
    }

    if (req.method === 'POST' && path === '/api/bot/thresholds') {
      const body = await readBody(req);
      const n = normalizeThreshold(body);
      const id = `custom-${Date.now().toString(36)}`;
      store.thresholds.push({ id, builtin: false, ...n });
      store.thresholds.sort((a, b) => a.meters - b.meters);
      saveStore();
      send(res, 201, { ok: true, id, ...publicConfig() });
      return;
    }

    const one = path.match(/^\/api\/bot\/thresholds\/([^/]+)$/);
    if (one) {
      const id = decodeURIComponent(one[1]);
      const idx = store.thresholds.findIndex((t) => t.id === id);
      if (idx < 0) {
        send(res, 404, { ok: false, error: 'limite não encontrado' });
        return;
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const current = store.thresholds[idx];
        const n = normalizeThreshold({ ...current, ...body }, current);
        store.thresholds[idx] = { ...current, ...n };
        store.thresholds.sort((a, b) => a.meters - b.meters);
        saveStore();
        send(res, 200, { ok: true, ...publicConfig() });
        return;
      }
      if (req.method === 'DELETE') {
        if (store.thresholds[idx].builtin) {
          send(res, 400, { ok: false, error: 'limites oficiais não podem ser excluídos — desative ou edite.' });
          return;
        }
        const removed = store.thresholds.splice(idx, 1)[0];
        delete store.fired[removed.id];
        saveStore();
        send(res, 200, { ok: true, ...publicConfig() });
        return;
      }
    }

    if (req.method === 'POST' && path === '/api/bot/test') {
      const body = await readBody(req);
      // SEM fallback para o primeiro limite: ID inválido significa erro do
      // cliente, e testar o limite errado ensaia a mensagem errada.
      const t = store.thresholds.find((x) => x.id === body.thresholdId);
      if (!t) {
        send(res, 404, { ok: false, error: 'limite não encontrado' });
        return;
      }
      const preTest = body.pre === true;
      const preM = preTest && Number(t.preWarningM) > 0 ? Number(t.preWarningM) : 0;
      if (preTest && (preM <= 0 || !t.preWarningMessage)) {
        send(res, 400, { ok: false, error: 'este limite não tem pré-alerta configurado (distância e mensagem)' });
        return;
      }
      const reading = store.lastReading || { level: t.meters, ts: Date.now(), flow: null };
      const entry = preTest
        ? await dispatchThreshold({ ...t, message: t.preWarningMessage }, reading, 'teste_manual', preM)
        : await dispatchThreshold(t, reading, 'teste_manual');
      send(res, 200, { ok: true, entry, ...publicConfig() });
      return;
    }

    if (req.method === 'POST' && path === '/api/bot/telegram/ingest') {
      const body = await readBody(req);
      const reply = commandReply(body.update || body);
      send(res, 200, { ok: true, replies: reply ? [reply] : [], ...publicConfig() });
      return;
    }

    if (req.method === 'GET' && path === '/api/bot/outbox') {
      send(res, 200, { ok: true, outbox: store.outbox || [] });
      return;
    }

    if (req.method === 'POST' && path === '/api/bot/outbox/ack') {
      const body = await readBody(req);
      const ids = new Set((body.ids || []).map(String));
      store.outbox = (store.outbox || []).filter((m) => !ids.has(String(m.id)));
      saveStore();
      send(res, 200, { ok: true, remaining: store.outbox.length });
      return;
    }

    if (req.method === 'POST' && path === '/api/bot/subscribers') {
      const body = await readBody(req);
      const chatId = parseChatId(body.chatId);
      const name = String(body.name || '').trim() || `Chat ${chatId}`;
      upsertSubscriber({ first_name: name }, { id: chatId });
      enqueueOutbox(
        chatId,
        `Inscrição confirmada.\nVocê receberá os alertas de cota do Rio dos Sinos em Campo Bom.\n\n${helpText()}`,
      );
      send(res, 200, { ok: true, ...publicConfig() });
      return;
    }

    const subPath = path.match(/^\/api\/bot\/subscribers\/([^/]+)$/);
    if (subPath && req.method === 'DELETE') {
      const chatId = decodeURIComponent(subPath[1]);
      store.subscribers = store.subscribers.filter((s) => String(s.chatId) !== String(chatId));
      saveStore();
      send(res, 200, { ok: true, ...publicConfig() });
      return;
    }

    send(res, 404, { ok: false, error: 'rota não encontrada' });
  } catch (err) {
    send(res, 400, { ok: false, error: err instanceof Error ? err.message : 'falha' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[api] http://${HOST}:${PORT}`);
  if (existsSync(DIST_DIR)) console.log(`[web] servindo ${DIST_DIR}`);
  startBot();
});

/* ------------------------------------------------------------------ */
/* util                                                                */
/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}
