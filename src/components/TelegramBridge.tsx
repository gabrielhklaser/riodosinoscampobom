import { useEffect, useRef } from 'react';
import { ackOutbox, fetchBotConfig, fetchOutbox, ingestTelegramUpdate } from '../lib/botApi';
import { telegramGetMe, telegramGetUpdates, telegramSend, telegramSetWebhook } from '../lib/telegramBridge';

/**
 * Mantém o bot vivo no navegador do administrador:
 * autentica, registra webhook, lê /start pendente e despacha a fila de mensagens.
 */
export default function TelegramBridge({
  onStatus,
}: {
  onStatus?: (s: { ok: boolean; username?: string; error?: string }) => void;
}) {
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    let stopped = false;
    let offset = Number(sessionStorage.getItem('cb-tg-offset') || '0') || 0;
    let token = '';

    async function boot() {
      try {
        const cfg = await fetchBotConfig();
        token = cfg.telegramToken || '';
        if (!token) throw new Error('token do bot ausente');
        const me = await telegramGetMe(token);
        if (stopped) return;
        const status = { ok: true, username: me.username };
        onStatusRef.current?.(status);
        window.dispatchEvent(new CustomEvent('cb-bot-status', { detail: status }));
        const origin = window.location.origin;
        if (origin.startsWith('https://')) {
          await telegramSetWebhook(token, `${origin}/api/telegram/webhook`);
        }
      } catch (err) {
        if (!stopped) {
          const status = {
            ok: false,
            error: err instanceof Error ? err.message : 'falha ao conectar o bot',
          };
          onStatusRef.current?.(status);
          window.dispatchEvent(new CustomEvent('cb-bot-status', { detail: status }));
        }
      }
    }

    async function tick() {
      if (!token) return;
      try {
        const updates = await telegramGetUpdates(token, offset);
        for (const upd of updates || []) {
          offset = upd.update_id + 1;
          sessionStorage.setItem('cb-tg-offset', String(offset));
          try {
            const res = await ingestTelegramUpdate(upd);
            for (const reply of res.replies || []) {
              await telegramSend(token, reply.chatId, reply.text);
            }
          } catch {
            /* continua o lote */
          }
        }
      } catch {
        /* getUpdates via proxy pode falhar; o webhook cobre */
      }
      try {
        const box = await fetchOutbox();
        const sent: string[] = [];
        for (const msg of box.outbox || []) {
          await telegramSend(token, msg.chatId, msg.text);
          sent.push(msg.id);
        }
        if (sent.length) await ackOutbox(sent);
      } catch {
        /* fila fica para o próximo ciclo */
      }
    }

    (async () => {
      while (!stopped) {
        if (!token) await boot();
        await tick();
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();

    return () => {
      stopped = true;
    };
  }, []);

  return null;
}
