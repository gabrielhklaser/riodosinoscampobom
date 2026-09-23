import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  RadioTower,
  RefreshCw,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  addSubscriber,
  createThreshold,
  deleteThreshold,
  fetchBotConfig,
  loginBot,
  removeSubscriber,
  testThreshold,
  updateThreshold,
  verifyBot as verifyBotStatus,
  type BotConfig,
  type BotThreshold,
} from '../lib/botApi';
import { BOT_START_LINK, BOT_USERNAME, parseChatId } from '../lib/telegramBridge';

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur';
const n2 = (v: number) => v.toFixed(2).replace('.', ',');

const EMPTY_FORM = { name: '', meters: '', message: '', preWarningM: '0', preWarningMessage: '' };

export default function BotSettings() {
  const [cfg, setCfg] = useState<BotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<BotThreshold | null>(null);
  const [chatId, setChatId] = useState('6810701338');
  const [chatName, setChatName] = useState('Administrador');
  const [needLogin, setNeedLogin] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function refresh() {
    const data = await fetchBotConfig();
    setCfg(data);
    setError(null);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao carregar as configurações do bot.';
        if (alive) {
          setError(msg);
          if (/não autorizado|401/i.test(msg)) setNeedLogin(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    const id = setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<BotConfig>) {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const data = await fn();
      setCfg(data);
      setNotice('Alteração salva.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(t: BotThreshold) {
    setEditing(t);
    setForm({
      name: t.name,
      meters: String(t.meters).replace('.', ','),
      message: t.message,
      preWarningM: t.preWarningM != null ? String(t.preWarningM).replace('.', ',') : '0',
      preWarningMessage: t.preWarningMessage || '',
    });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function handleVerify() {
    setVerifying(true);
    setNotice(null);
    setError(null);
    try {
      const data = await verifyBotStatus();
      setCfg(data);
      if (data.bot.ok) setNotice(`Bot reverificado: @`+data.bot.username+` online.`);
      else setError(data.bot.lastError || 'Bot continua offline.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reverificar.');
    } finally {
      setVerifying(false);
    }
  }

  /**
   * Teste de envio por limite — usa o resultado real do disparo (entry)
   * para dizer quantos chats receberam ou por que falhou, em vez do
   * genérico "Alteração salva.".
   */
  async function handleTest(t: BotThreshold, pre = false) {
    setSaving(true);
    setNotice(null);
    setError(null);
    const oQue = pre ? `pré-aviso de “${t.name}”` : `“${t.name}”`;
    try {
      const data = await testThreshold(t.id, pre);
      setCfg(data);
      const e = data.entry;
      if (e.ok) {
        setNotice(`Teste do ${oQue} enviado para ${e.chats} chat(s) — checado no Telegram?`);
      } else {
        setError(`Teste do ${oQue} não saiu: ${e.error || 'sem destinatário inscrito'}. Veja o histórico de disparos.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no teste de envio.');
    } finally {
      setSaving(false);
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const meters = Number(form.meters.replace(',', '.'));
    const payload = {
      name: form.name.trim(),
      meters,
      message: form.message.trim(),
      preWarningM: Number(String(form.preWarningM).replace(',', '.') || 0),
      preWarningMessage: form.preWarningMessage.trim(),
    };
    if (editing) {
      await run(() => updateThreshold(editing.id, payload));
      cancelEdit();
    } else {
      await run(() => createThreshold(payload));
      setForm(EMPTY_FORM);
    }
  }

  if (loading) {
    return (
      <div className={`flex h-72 items-center justify-center ${CARD}`}>
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-sky-400" />
        <span className="text-sm text-slate-400">Carregando configurações do bot…</span>
      </div>
    );
  }

  const activeSubs = cfg?.subscribers.filter((s) => s.active).length ?? 0;

  return (
    <div className="space-y-6">
      <section className={`p-5 sm:p-6 ${CARD}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-400/80">Acesso restrito</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-bold text-white">
              <Bot className="h-5 w-5 text-sky-400" />
              Configurações do Bot
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Alertas automáticos do Rio dos Sinos pelo Telegram{' '}
              <a
                className="font-semibold text-sky-300 hover:underline"
                href={`https://t.me/${BOT_USERNAME}`}
                target="_blank"
                rel="noreferrer"
              >
                @{BOT_USERNAME}
              </a>
              . Quando a leitura atingir ou ultrapassar um limite cadastrado, a mensagem correspondente é disparada
              para os inscritos.
            </p>
          </div>
          <a
            href={`https://t.me/${BOT_USERNAME}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 self-start rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-950/40 hover:bg-sky-500"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Abrir @{BOT_USERNAME}
          </a>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            icon={<RadioTower className="h-4 w-4" />}
            label="Status do bot"
            value={cfg?.bot.ok ? 'Online' : (cfg?.bot.consecutiveFails ? `Instável (${cfg.bot.consecutiveFails}/3)` : 'Offline')}
            hint={(() => {
              if (cfg?.bot.ok) {
                const lc = cfg.bot.lastSuccess ? new Date(cfg.bot.lastSuccess).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;
                return lc ? `@${cfg.bot.username || BOT_USERNAME} · ok em ${lc}` : `@${cfg.bot.username || BOT_USERNAME}`;
              }
              if (cfg?.bot.lastError && /transiente/.test(cfg.bot.lastError)) return cfg.bot.lastError;
              return cfg?.bot.lastError || `@${cfg?.bot.username || BOT_USERNAME}`;
            })()}
            ok={!!cfg?.bot.ok}
          />
          <Stat
            icon={<Users className="h-4 w-4" />}
            label="Inscritos ativos"
            value={String(activeSubs)}
            hint="quem enviou /start"
            ok={activeSubs > 0}
          />
          <Stat
            icon={<Bell className="h-4 w-4" />}
            label="Última leitura"
            value={cfg?.lastReading ? `${n2(cfg.lastReading.level)} m` : '—'}
            hint={
              cfg?.lastReading
                ? new Date(cfg.lastReading.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                : 'aguardando telemetria'
            }
            ok={!!cfg?.lastReading}
          />
        </div>

        {/* Diagnóstico de conexão — dupla checagem do status real */}
        {cfg && !cfg.bot.ok && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-semibold text-amber-200">Bot aparece como Offline no painel</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-amber-100/90">
                    {cfg.bot.lastError && /invalid token|unauthorized|forbidden/i.test(cfg.bot.lastError)
                      ? 'Token rejeitado pelo Telegram — verifique TELEGRAM_BOT_TOKEN no servidor (pode ter sido revogado).'
                      : cfg.bot.lastError && /transiente/.test(cfg.bot.lastError)
                        ? 'Falha transitória de rede do servidor com a API do Telegram — o bot pode estar online no Telegram mas o servidor ainda não conseguiu reconectar. Reverifique abaixo.'
                        : 'O servidor não conseguiu confirmar o bot com getMe. Isso acontece quando há instabilidade de rede entre o servidor e api.telegram.org, mesmo que o bot responda normalmente dentro do Telegram.'}
                  </p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-amber-100/70">
                    <li>Última verificação: {cfg.bot.lastChecked ? new Date(cfg.bot.lastChecked).toLocaleString('pt-BR') : '—'}</li>
                    <li>Último sucesso: {cfg.bot.lastSuccess ? new Date(cfg.bot.lastSuccess).toLocaleString('pt-BR') : 'nunca'}</li>
                    <li>Falhas consecutivas: {cfg.bot.consecutiveFails ?? 0}/3</li>
                    <li>Teste direto: abra <a className="underline" href={`https://t.me/${cfg.bot.username || BOT_USERNAME}`} target="_blank" rel="noreferrer">@{cfg.bot.username || BOT_USERNAME}</a> e envie /start — se responder, o token está válido e é só rede do servidor.</li>
                  </ul>
                </div>
              </div>
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="mt-3 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/20 px-3.5 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30 disabled:opacity-60 sm:mt-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} />
                {verifying ? 'Reverificando...' : 'Reverificar agora'}
              </button>
            </div>
          </div>
        )}

        {cfg && cfg.bot.ok && (cfg.bot.consecutiveFails ?? 0) > 0 && (
          <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-200">
            Transiente de rede: {cfg.bot.lastError} — próxima tentativa automática em segundos. O bot segue ONLINE enquanto as falhas não atingem 3 consecutivas.
          </div>
        )}

        {cfg && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={handleVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-700/60 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} />
              {verifying ? 'Reverificando...' : 'Reverificar status'}
            </button>
            <span className="text-[11px] text-slate-500">Verificado em {cfg.bot.lastChecked ? new Date(cfg.bot.lastChecked).toLocaleString('pt-BR') : '—'} · sucesso em {cfg.bot.lastSuccess ? new Date(cfg.bot.lastSuccess).toLocaleString('pt-BR') : '—'}</span>
          </div>
        )}
      </section>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}
      {notice && !error && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <p className="text-sm text-emerald-200">{notice}</p>
        </div>
      )}

      <section className={`overflow-hidden ${CARD}`}>
        <div className="border-b border-slate-800 px-6 py-4">
          <h3 className="text-base font-bold text-white">Limites de alerta</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Edite a cota em metros e o texto enviado pelo bot. Use {'{nivel}'}, {'{cota}'}, {'{hora}'}, {'{nome}'} e{' '}
            {'{pre}'} na mensagem. Novos limites entram na comparação automaticamente. O <strong className="text-slate-300">Pré-aviso</strong>{' '}
            avisa antes da cota (ex.: 0,30 m antes). O botão <Send className="inline h-3 w-3" /> envia a mensagem daquele
            limite e o <Bell className="inline h-3 w-3" /> testa o pré-aviso — sempre marcados com “🧪 TESTE”, sem afetar
            os alertas reais.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-900/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-2.5 font-semibold">Limite</th>
                <th className="px-3 py-2.5 font-semibold">Cota</th>
                <th className="px-3 py-2.5 font-semibold">Pré-aviso</th>
                <th className="px-3 py-2.5 font-semibold">Mensagem</th>
                <th className="px-3 py-2.5 font-semibold">Ativo</th>
                <th className="px-6 py-2.5 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {(cfg?.thresholds ?? []).map((t) => {
                const fired = cfg?.fired?.[t.id];
                const preFired = cfg?.fired?.[`${t.id}:pre`];
                const preM = t.preWarningM ?? 0;
                return (
                  <tr key={t.id} className="align-top hover:bg-slate-800/40">
                    <td className="px-6 py-3">
                      <p className="font-semibold text-slate-100">{t.name}</p>
                      <p className="text-[11px] text-slate-500">{t.builtin ? 'cota oficial' : 'personalizado'}</p>
                      {fired && (
                        <p className="mt-1 text-[10px] font-semibold text-orange-300">
                          Disparado em {n2(fired.level)} m
                        </p>
                      )}
                      {preFired && !fired && (
                        <p className="mt-1 text-[10px] font-semibold text-amber-300/80">
                          Pré-avisado em {n2(preFired.level)} m
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-bold tabular-nums text-sky-300">{n2(t.meters)} m</td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                      {preM > 0 ? (
                        <>
                          <span className="font-semibold text-amber-300">{n2(t.meters - preM)} m</span>
                          <span className="block text-[10px] text-slate-600">({n2(preM)} m antes)</span>
                        </>
                      ) : (
                        <span className="text-slate-600">desativado</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs leading-relaxed text-slate-400">
                      <pre className="max-w-md whitespace-pre-wrap font-sans">{t.message}</pre>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        disabled={saving}
                        onClick={() => run(() => updateThreshold(t.id, { enabled: !t.enabled }))}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${
                          t.enabled
                            ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/25'
                            : 'bg-slate-800 text-slate-500 ring-white/10'
                        }`}
                      >
                        {t.enabled ? 'Ativo' : 'Pausado'}
                      </button>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1.5">
                        <IconBtn title="Editar" onClick={() => startEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          title={`Testar envio desta mensagem para todos os inscritos (sai marcada como TESTE)`}
                          onClick={() => handleTest(t)}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </IconBtn>
                        {preM > 0 && (
                          <IconBtn
                            title={`Testar o pré-aviso deste limite (dispara em ${n2(t.meters - preM)} m) para todos os inscritos (sai marcado como TESTE)`}
                            onClick={() => handleTest(t, true)}
                          >
                            <Bell className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                        {!t.builtin && (
                          <IconBtn title="Excluir" danger onClick={() => run(() => deleteThreshold(t.id))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`p-5 sm:p-6 ${CARD}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Plus className="h-4 w-4 text-sky-400" />
              {editing ? `Editar “${editing.name}”` : 'Adicionar novo limite'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {editing
                ? 'Altere a cota em metros e o texto associado a este limite.'
                : 'Inclua um limite extra (ex.: cota operacional interna) com a mensagem que o bot deve enviar.'}
            </p>
          </div>
          {editing && (
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" /> Cancelar
            </button>
          )}
        </div>

        <form onSubmit={submitForm} className="grid grid-cols-1 gap-4 md:grid-cols-6">
          <label className="md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Nome</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="Ex.: Atenção reforçada"
            />
          </label>
          <label className="md:col-span-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cota (m)</span>
            <input
              required
              inputMode="decimal"
              value={form.meters}
              onChange={(e) => setForm((f) => ({ ...f, meters: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="6,20"
            />
          </label>
          <label className="md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Pré-aviso (m antes da cota)
            </span>
            <input
              inputMode="decimal"
              min={0}
              max={5}
              step={0.1}
              value={form.preWarningM}
              onChange={(e) => setForm((f) => ({ ...f, preWarningM: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="0,30"
            />
            <span className="mt-1 block text-[10px] text-slate-600">0 desativa. Ex.: 0,30 avisa 0,30 m antes do nível.</span>
          </label>
          <label className="md:col-span-6">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mensagem do Telegram</span>
            <textarea
              required
              rows={5}
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder={'⚠️ ALERTA — Defesa Civil de Campo Bom\nNível atual: {nivel} m (cota {cota} m)'}
            />
          </label>
          <label className="md:col-span-6">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Mensagem do pré-aviso (opcional — placeholders {'{nivel}'}, {'{cota}'}, {'{pre}'}, {'{nome}'}, {'{hora}'})
            </span>
            <textarea
              rows={3}
              value={form.preWarningMessage}
              onChange={(e) => setForm((f) => ({ ...f, preWarningMessage: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder={'🟡 PRÉ-AVISO — Defesa Civil de Campo Bom\nO Rio dos Sinos está se aproximando do nível de {nome} ({cota} m).\nNível atual: {nivel} m (referência do pré-aviso: {pre} m).'}
            />
            <span className="mt-1 block text-[10px] text-slate-600">
              Só envia quando a distância acima for maior que 0. Sem mensagem, o pré-aviso não dispara.
            </span>
          </label>
          <div className="md:col-span-6">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editing ? 'Salvar alterações' : 'Adicionar limite'}
            </button>
          </div>
        </form>
      </section>

      <section className={`p-5 sm:p-6 ${CARD}`}>
        <h3 className="flex items-center gap-2 text-base font-bold text-white">
          <Users className="h-4 w-4 text-sky-400" />
          Destinatários
        </h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Caminho preferencial: a pessoa abre{' '}
          <a className="font-semibold text-sky-300 hover:underline" href={BOT_START_LINK} target="_blank" rel="noreferrer">
            @{BOT_USERNAME}
          </a>{' '}
          e toca em <strong className="text-slate-200">Iniciar</strong>. O /start entra sozinho nesta lista. O campo
          abaixo é só para cadastrar um Chat ID manualmente (sem vírgula).
        </p>

        {needLogin && (
          <form
            className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const user = (form.elements.namedItem('reuser') as HTMLInputElement).value;
              const pass = (form.elements.namedItem('repass') as HTMLInputElement).value;
              try {
                await loginBot(user, pass);
                setNeedLogin(false);
                await refresh();
                setNotice('Sessão restaurada. Pode cadastrar destinatários.');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Login recusado.');
              }
            }}
          >
            <p className="text-sm font-semibold text-amber-200">Sessão do painel expirada — entre de novo para cadastrar.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input name="reuser" defaultValue="admin" className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" />
              <input name="repass" type="password" placeholder="Senha" className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" />
              <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900">
                Entrar
              </button>
            </div>
          </form>
        )}

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            let id = '';
            try {
              id = parseChatId(chatId);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Chat ID inválido');
              return;
            }
            await run(async () => {
              const data = await addSubscriber(id, chatName.trim());
              setChatId('');
              setChatName('');
              return data;
            });
            // a confirmação sai pela fila do servidor (outbox) quando ele
            // está online no Telegram — o token não é exposto ao navegador
            setNotice(`Destinatário ${id} cadastrado. A mensagem de confirmação será enviada pelo servidor.`);
          }}
        >
          <input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            inputMode="numeric"
            placeholder="Chat ID (ex.: 6810701338)"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <input
            value={chatName}
            onChange={(e) => setChatName(e.target.value)}
            placeholder="Nome (opcional)"
            className="sm:w-48 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-60"
          >
            {saving ? 'Cadastrando…' : 'Cadastrar'}
          </button>
        </form>

        <ul className="mt-4 divide-y divide-slate-800/70">
          {(cfg?.subscribers ?? []).length === 0 && (
            <li className="py-6 text-center text-sm text-slate-500">Nenhum destinatário ainda.</li>
          )}
          {(cfg?.subscribers ?? []).map((s) => (
            <li key={String(s.chatId)} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {s.name}
                  {s.username ? <span className="ml-1 text-slate-500">@{s.username}</span> : null}
                </p>
                <p className="text-[11px] text-slate-500">
                  ID {s.chatId} · {s.active ? 'ativo' : 'pausado'}
                </p>
              </div>
              <button
                onClick={() => run(() => removeSubscriber(s.chatId))}
                className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-red-400/40 hover:text-red-300"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={`overflow-hidden ${CARD}`}>
        <div className="border-b border-slate-800 px-6 py-4">
          <h3 className="text-base font-bold text-white">Histórico de disparos</h3>
          <p className="text-xs text-slate-400">Últimos envios automáticos e testes manuais.</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/95 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-2.5 font-semibold">Quando</th>
                <th className="px-3 py-2.5 font-semibold">Limite</th>
                <th className="px-3 py-2.5 text-right font-semibold">Nível</th>
                <th className="px-3 py-2.5 text-right font-semibold">Chats</th>
                <th className="px-6 py-2.5 font-semibold">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {(cfg?.log ?? []).map((row, i) => (
                <tr key={`${row.ts}-${i}`}>
                  <td className="whitespace-nowrap px-6 py-2.5 text-slate-400">
                    {new Date(row.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-3 py-2.5 text-slate-200">
                    {row.name}
                    {row.reason === 'teste_manual' ? (
                      <span className="ml-1.5 rounded bg-slate-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                        teste
                      </span>
                    ) : row.reason === 'pre_alerta' ? (
                      <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                        pré-aviso
                      </span>
                    ) : (
                      <span className="ml-1.5 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300">
                        cruzou cota
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-sky-300">{n2(row.level)} m</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{row.chats}</td>
                  <td className="px-6 py-2.5 text-xs">
                    {row.ok ? (
                      <span className="text-emerald-300">enviado</span>
                    ) : (
                      <span className="text-amber-300">{row.error || 'sem destinatário'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!(cfg?.log ?? []).length && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500">
                    Nenhum disparo registrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span className={`rounded-md p-1.5 ${ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums text-white">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-md border p-1.5 transition ${
        danger
          ? 'border-slate-700 text-slate-400 hover:border-red-400/40 hover:text-red-300'
          : 'border-slate-700 text-slate-400 hover:border-sky-400/40 hover:text-sky-300'
      }`}
    >
      {children}
    </button>
  );
}
