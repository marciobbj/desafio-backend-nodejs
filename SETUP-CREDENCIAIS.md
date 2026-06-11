# Guia de Credenciais — Meta WhatsApp Cloud API & OpenAI

Você consegue completar **todo o desafio usando o mock da Meta** que fornecemos — não é
obrigatório ter um número/app real. Este guia existe para quem quiser ir além e testar contra
a API real, e para explicar como obter a chave da OpenAI com custo mínimo.

---

## 1. OpenAI (necessária para a parte de IA)

1. Crie uma conta em <https://platform.openai.com>.
2. **Crie um Project dedicado** para este desafio (menu de Projects no topo). Isso isola os
   limites e facilita acompanhar o gasto.
3. Em **Settings → Limits / Billing → Usage limits**, defina um **hard limit** baixo
   (ex.: US$ 5) e um **soft limit** (ex.: US$ 3). Não existe limite por chave individual — o
   controle é por **projeto/conta**, então configure aqui.
4. Em **API keys**, gere uma chave **dentro do Project** criado e coloque em `OPENAI_API_KEY`
   no seu `.env`.
5. Use o modelo **`gpt-4o-mini`** — é barato e mais que suficiente para este desafio. Para
   alguns milhares de mensagens de teste, o custo fica em centavos de dólar.

> Dica: se quiser blindar custo, dá para zerar o rate limit dos modelos caros
> (`gpt-4o`, `o1`) dentro do Project, deixando só o `gpt-4o-mini` disponível.

---

## 2. Meta WhatsApp Cloud API (opcional — só se quiser testar contra a API real)

> ⚠️ O token de acesso temporário do painel **expira em 24h** e vai te interromper no meio do
> desafio. Por isso o passo do **System User token** abaixo é importante para uso prolongado.

1. Crie um app em <https://developers.facebook.com> → **Create App** → tipo **Business**.
2. Adicione o produto **WhatsApp**. A Meta provisiona um **número de teste** gratuito e um
   `phone_number_id`.
3. No painel do WhatsApp, copie:
   - **Temporary access token** (24h) → bom para um teste rápido.
   - **Phone number ID** e **WhatsApp Business Account ID**.
4. Em **App Settings → Basic**, copie o **App Secret** → vai em `META_APP_SECRET`
   (é com ele que se valida a assinatura `X-Hub-Signature-256`).
5. **Configurar o webhook** (Configuration → Webhooks):
   - **Callback URL**: a URL pública do seu backend (use `ngrok`/`cloudflared` para expor a 8000).
   - **Verify token**: qualquer string que você definir → coloque a mesma em `META_VERIFY_TOKEN`.
   - Assine o campo **`messages`**.
6. **Token que não expira (recomendado para durar o desafio inteiro)** — crie um *System User*:
   - Business Settings → **Users → System Users → Add** (role Admin).
   - **Add Assets** → seu app WhatsApp, com permissão total.
   - **Generate new token** → selecione `whatsapp_business_messaging` e
     `whatsapp_business_management`. Esse token é de longa duração → use em `META_TOKEN`.

### Testando rápido sem nada disso
Use nosso mock: `POST http://localhost:8001/simulate/inbound` injeta uma mensagem assinada
como se viesse da Meta, e `POST http://localhost:8001/{phoneNumberId}/messages` recebe os
seus envios. Veja o [README](README.md#-como-começar).

---

## Resumo das variáveis (`.env`)

| Variável | De onde vem | Obrigatória? |
|----------|-------------|--------------|
| `OPENAI_API_KEY` | OpenAI (Project) | Sim |
| `META_VERIFY_TOKEN` | Você define (qualquer string) | Sim (handshake) |
| `META_APP_SECRET` | App real **ou** valor do mock (`.env.example`) | Sim (assinatura) |
| `META_TOKEN` | System User token (real) — opcional com mock | Não (com mock) |
| `META_API_BASE_URL` | `http://localhost:8001` (mock) ou `https://graph.facebook.com/v21.0` | Sim |
| `META_PHONE_NUMBER_ID` | Mock aceita qualquer valor | Sim |
