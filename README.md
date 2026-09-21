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
| `TELEGRAM_BOT_TOKEN` | **Obrigatória.** Token do BotFather (nunca commite o valor real) |
| `TELEGRAM_BOT_USERNAME` | `defesacivilcampobom_bot` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | **Obrigatória a senha.** Login do painel técnico (o servidor não inicia sem ela) |
| `PORT` | Porta HTTP (hosts como Render/Railway injetam sozinhos) |
| `TELEGRAM_WEBHOOK_URL` | Opcional. Se o site tiver HTTPS público, use `https://SEU-DOMINIO/api/telegram/webhook?secret_token=um-segredo-aleatorio` — o `secret_token` faz o servidor validar a origem do webhook |

Sem `TELEGRAM_WEBHOOK_URL` o bot usa **polling** — funciona em VPS, mesmo sem domínio.

### ⚠️ Credenciais (leia antes de subir)

- O repositório já foi publicado com o token antigo do bot e a senha antiga do
  painel em texto plano. **Considere ambos vazados:**
  1. No BotFather, envie `/revoke` para `@defesacivilcampobom_bot` e copie o token novo;
  2. Escolha uma nova senha forte para `ADMIN_PASSWORD`.
- O servidor **recusa iniciar** sem `TELEGRAM_BOT_TOKEN` e `ADMIN_PASSWORD` no `.env`
  (mensagem de log diz exatamente o que falta).
- O token do bot **não é mais enviado** ao navegador em `/api/bot/config`.
  Só volta a ser exposto (para administradores) se você definir
  `TELEGRAM_BROWSER_BRIDGE=1` — fallback de emergência; mantenha desligado em produção.
- Rollback dessas mudanças: `git revert` do commit — mas o token antigo
  continuaria válido enquanto não for revogado no BotFather.

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

- Usuário/senha: definidos em `.env` (`ADMIN_USER` / `ADMIN_PASSWORD`) —
  não são publicados neste README (nunca commite o `.env` com valores reais).

Aba **Configurações do Bot**: cotas, mensagens, destinatários e histórico de disparos.

Cada limite tem um **Pré-aviso** opcional: a distância em metros antes da
cota em que o bot avisa de chegada (ex.: `0,30` = avisa 0,30 m antes), com
mensagem própria (placeholder `{pre}` = nível do pré-aviso) e `0` para
desativar. O pré-aviso dispara uma única vez por subida; se a leitura pular
direto para cima da cota, ganha o alerta principal. Os botões de teste
(Send / sino) enviam a mensagem do limite — ou do pré-aviso — para todos os
inscritos, sempre marcados com “🧪 TESTE — não é um alerta real”, sem
afetar o estado dos alertas de verdade.

## Desenvolvimento local

```bash
cp .env.example .env   # preencha o token e a senha antes!
npm install
npm run dev
```

Sobe a API em `:3001` e o Vite em `:5173` (com proxy `/api`).

## Solução de problemas

Sintoma → causa provável → o que fazer:

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Servidor não inicia; log diz `Variável(is) ausente(s) no .env` | `.env` inexistente ou incompleto | `cp .env.example .env`, preencha `TELEGRAM_BOT_TOKEN` e `ADMIN_PASSWORD`, suba de novo |
| Log `[bot] falha ao autenticar: ...` | Token errado/revogado | Gere token novo no BotFather (`/revoke` → `/token`) e atualize o `.env`; reinicie |
| Bot offline (`/api/health` → `online: false`) | Sem saída para `api.telegram.org` (comum em preview/sandbox) | Em VPS com internet, o polling resolve sozinho. No painel, a aba Configurações mostra `lastError` com o motivo exato |
| Painel sem dados do rio | ANA fora do ar ou proxies CORS sem resposta | Aguarde a próxima atualização; o servidor grava a última leitura e o log `[ana]` mostra o erro exato |
| Curva de projeção sem remanso / sem dados em estações ANA | Estação a montante fora do ar | `console.warn` no DevTools (F12) diz qual estação falhou; o restante da curva continua válido (degradação graciosa) |
| Alertas não chegam no Telegram | Bot offline ou sem inscritos | Verifique o histórico de disparos na aba Configurações (`log`): o campo `error` diz o motivo (ex.: `Nenhum destinatário inscrito`) |
| Webhook rejeitado (`403 secret_token inválido`) | Webhook configurado sem o `secret_token` da URL do `.env` | Registre o webhook com o mesmo `secret_token` de `TELEGRAM_WEBHOOK_URL`, ou remova o `secret_token` da URL |
