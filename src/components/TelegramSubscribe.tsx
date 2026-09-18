import { MessageCircle } from 'lucide-react';
import { BOT_START_LINK, BOT_USERNAME } from '../lib/telegramBridge';

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur';

/** Convite público: qualquer pessoa se inscreve abrindo o bot e tocando em Iniciar. */
export default function TelegramSubscribe() {
  return (
    <section className={`p-5 sm:p-6 ${CARD}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-400/80">Alertas no celular</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-white">
            <MessageCircle className="h-5 w-5 text-sky-400" />
            Receba os avisos da Defesa Civil no Telegram
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Aberto a qualquer pessoa. Toque no botão, abra{' '}
            <span className="font-semibold text-slate-200">@{BOT_USERNAME}</span> e pressione{' '}
            <strong className="text-slate-200">Iniciar</strong>. Você passa a receber os alertas de cota do Rio dos
            Sinos automaticamente. Para sair, envie /stop no próprio chat.
          </p>
        </div>
        <a
          href={BOT_START_LINK}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-950/40 transition hover:bg-sky-500"
        >
          <MessageCircle className="h-4 w-4" />
          Inscrever-se no bot
        </a>
      </div>
    </section>
  );
}
