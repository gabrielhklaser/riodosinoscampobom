# Rio dos Sinos · Campo Bom

Painel de monitoramento do Rio dos Sinos em Campo Bom/RS e bot Telegram **[@defesacivilcampobom_bot](https://t.me/defesacivilcampobom_bot)**.

Um único processo Node serve o site, lê a telemetria da ANA e mantém o bot **online** (long poll / webhook). Enquanto `npm start` estiver rodando num servidor com saída HTTPS, o `/start` responde e os alertas de cota são disparados.

## Como as pessoas se inscrevem

1. Abrir https://t.me/defesacivilcampobom_bot?start=alerta
2. Tocar em **Iniciar**
3. Pronto — passam a receber os avisos

Comandos no chat: `/start` · `/stop` · `/nivel` · `/ajuda`

## Subir no servidor (a partir do GitHub)

```bash
git clone https://github.com/gabrielhklaser/riodosinoscampobom.git
cd riodosinoscampobom
git checkout main   # ou a branch que você estiver usando
npm ci
cp .env.example .env   # ajuste se quiser
npm run build
npm start
```

O painel e a API sobem na porta `PORT` (padrão **3001**). O bot autentica em `@defesacivilcampobom_bot` e começa a ouvir mensagens.

### Variáveis (`.env`)

| Variável | Função |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token do BotFather |
| `TELEGRAM_BOT_USERNAME` | `defesacivilcampobom_bot` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Login do painel técnico |
| `PORT` | Porta HTTP (hosts como Render/Railway injetam sozinhos) |
| `TELEGRAM_WEBHOOK_URL` | Opcional. Se o site tiver HTTPS público, use `https://SEU-DOMINIO/api/telegram/webhook` |

Sem `TELEGRAM_WEBHOOK_URL` o bot usa **polling** — funciona em VPS, mesmo sem domínio.

### systemd (VPS)

```ini
[Unit]
Description=Rio dos Sinos Campo Bom
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/riodosinoscampobom
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Atualizar depois de um push:

```bash
cd /opt/riodosinoscampobom
git pull
npm ci
npm run build
sudo systemctl restart riodosinoscampobom
```

## Painel técnico

No rodapé do site: **Acesso restrito**

- Usuário: `admin`
- Senha: `CBdefesacivil2026`

Aba **Configurações do Bot**: cotas, mensagens, destinatários e histórico de disparos.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Sobe a API em `:3001` e o Vite em `:5173` (com proxy `/api`).
