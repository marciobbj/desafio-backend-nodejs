# Execucao do Ambiente

Guia operacional para rodar o backend WhatsApp com IA, com Docker, com app no host e sem Docker.

## Requisitos

- Node.js 20+
- npm
- Docker e Docker Compose, se for usar o ambiente containerizado
- Opcional: LM Studio ou OpenAI API key para respostas por LLM

## Variaveis de ambiente

Crie o `.env` a partir do exemplo:

```bash
cp .env.example .env
```

Para OpenAI real:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
LLM_TOOL_CALLING_ENABLED=true
```

Os detalhes de cada caminho de resposta estao em [Modos de resposta](#modos-de-resposta).

Para LM Studio rodando no host, usando o modelo `google/gemma-3n-e4b`:

```env
OPENAI_API_KEY=lm-studio
OPENAI_MODEL=google/gemma-3n-e4b
OPENAI_BASE_URL=http://127.0.0.1:1234
LLM_TOOL_CALLING_ENABLED=false
```

Se backend e worker estiverem dentro do Docker, use `host.docker.internal`:

```env
OPENAI_API_KEY=lm-studio
OPENAI_MODEL=google/gemma-3n-e4b
OPENAI_BASE_URL=http://host.docker.internal:1234
LLM_TOOL_CALLING_ENABLED=false
```

Se o `.env` estiver com `OPENAI_BASE_URL=http://127.0.0.1:1234`, o modelo local so sera acessivel quando backend e worker rodarem no host. Para Docker, troque para `http://host.docker.internal:1234`.

## Rodando tudo com Docker

Instale as dependencias localmente primeiro. O compose monta o diretorio do projeto dentro dos containers, incluindo `node_modules`.

```bash
npm install
cp .env.example .env
docker compose up -d --build
```

O compose sobe:

- Postgres em `localhost:5432`
- Redis em `localhost:6379`
- backend em `localhost:8000`
- worker
- mock da Meta em `localhost:8001`
- LocalStack em `localhost:4566`

O backend executa `npm run db:migrate` no boot.

Verifique os servicos:

```bash
docker compose ps
curl http://localhost:8000/health
curl http://localhost:8001/health
```

Simule uma mensagem inbound:

```bash
curl -X POST http://localhost:8001/simulate/inbound \
  -H "Content-Type: application/json" \
  -d '{ "from": "5511999990000", "text": "Quais sao os planos de voces?" }'
```

Veja as mensagens enviadas ao mock:

```bash
curl http://localhost:8001/sent
```

Logs:

```bash
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f mock-meta
```

Parar o ambiente:

```bash
docker compose down
```

Para apagar tambem o volume do Postgres:

```bash
docker compose down -v
```

## Rodando app no host com infra em Docker

Este modo e o mais pratico para desenvolver e para testar LM Studio em `http://127.0.0.1:1234`.

Suba apenas a infraestrutura:

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis mock-meta
```

Nesse modo, o mock precisa entregar webhooks para o backend no host:

```bash
CANDIDATE_WEBHOOK_URL=http://host.docker.internal:8000/webhook docker compose up -d --force-recreate mock-meta
```

Em seguida, aplique migrations e rode backend e worker no host:

```bash
npm run db:migrate
npm run dev
```

Em outro terminal:

```bash
npm run worker
```

Simule uma mensagem:

```bash
curl -X POST http://localhost:8001/simulate/inbound \
  -H "Content-Type: application/json" \
  -d '{ "from": "5511999990000", "text": "Quais sao os planos de voces?" }'
```

## Rodando sem Docker

Use este modo se voce ja tem Postgres e Redis instalados localmente.

Crie um banco Postgres:

```bash
createdb atendimento
```

Configure o `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/atendimento
REDIS_URL=redis://localhost:6379
META_API_BASE_URL=http://localhost:8001
```

Instale dependencias e aplique migrations:

```bash
npm install
npm run db:migrate
```

Inicie Redis e Postgres pelos seus servicos locais. Depois rode a aplicacao:

```bash
npm run dev
```

Em outro terminal:

```bash
npm run worker
```

O mock da Meta tambem precisa estar rodando. A forma mais simples e manter apenas o mock via Docker:

```bash
CANDIDATE_WEBHOOK_URL=http://host.docker.internal:8000/webhook docker compose up -d mock-meta
```

Se quiser realmente evitar Docker tambem para o mock, rode o servidor diretamente:

```bash
cd mock-meta-server
CANDIDATE_WEBHOOK_URL=http://localhost:8000/webhook npm start
```

## Modos de resposta

O worker pode formar a resposta por tres caminhos.

### Deterministico

Nao usa LLM externa. O worker recupera trechos da `knowledge-base/` por busca lexical e retorna uma resposta local.

Use para validar o fluxo sem depender de credenciais:

```env
OPENAI_API_KEY=sk-proj-troque-pela-sua-chave
OPENAI_BASE_URL=
LLM_TOOL_CALLING_ENABLED=false
```

Smoke test:

```bash
REPLY_MODE=deterministic ./scripts/test-flows.sh
```

### LM Studio

Usa um modelo local com endpoint OpenAI-compatible. Este modo foi incluido para testar a integracao LLM sem depender de uma chave externa da OpenAI.

No LM Studio:

1. Carregue o modelo `google/gemma-3n-e4b`. (ou qualquer outro que deseje testar)
2. Inicie o servidor OpenAI-compatible na porta `1234`.
3. Configure o `.env`.

App no host:

```env
OPENAI_BASE_URL=http://127.0.0.1:1234
```

App no Docker:

```env
OPENAI_BASE_URL=http://host.docker.internal:1234
```

Importante: `127.0.0.1` dentro do container e o proprio container, nao o host. Para backend/worker em Docker, o LM Studio precisa estar acessivel em `host.docker.internal:1234`. Se der timeout, habilite no LM Studio a opcao de aceitar conexoes da rede/local network, ou rode backend e worker no host usando `OPENAI_BASE_URL=http://127.0.0.1:1234`.

Para modelos locais, mantenha:

```env
LLM_TOOL_CALLING_ENABLED=false
LLM_REQUEST_TIMEOUT_MS=600000
```

Smoke test:

```bash
REPLY_MODE=lmstudio ./scripts/test-flows.sh
```

O script valida primeiro `GET /v1/models` a partir do container backend. Se essa checagem falhar, o problema e conectividade entre Docker e host, nao a cadeia LangChain.

Modelos locais podem demorar no primeiro carregamento. Para aumentar a espera do smoke test:

```bash
REPLY_MODE=lmstudio SMOKE_RESPONSE_TIMEOUT_SECONDS=420 LLM_REQUEST_TIMEOUT_MS=900000 ./scripts/test-flows.sh
```

Se quiser usar outro modelo local:

```bash
REPLY_MODE=lmstudio LMSTUDIO_MODEL=nome/do-modelo ./scripts/test-flows.sh
```

### OpenAI

Usa a API externa da OpenAI via LangChain.

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=
LLM_TOOL_CALLING_ENABLED=true
```

Smoke test:

```bash
REPLY_MODE=openai OPENAI_API_KEY=sk-... ./scripts/test-flows.sh
```

Se quiser desabilitar tool calling:

```bash
REPLY_MODE=openai OPENAI_API_KEY=sk-... LLM_TOOL_CALLING_ENABLED=false ./scripts/test-flows.sh
```

## API REST

Gere um token de desenvolvimento:

```bash
npm run token:dev
```

Use o token:

```bash
curl http://localhost:8000/conversations \
  -H "Authorization: Bearer <TOKEN>"

curl http://localhost:8000/conversations/<CONVERSATION_ID>/messages \
  -H "Authorization: Bearer <TOKEN>"
```

Configuracao de IA por tenant:

```bash
curl http://localhost:8000/tenant/ai-settings \
  -H "Authorization: Bearer <TOKEN>"
```

Atualize o prompt, modelo, temperatura ou tool calling:

```bash
curl -X PATCH http://localhost:8000/tenant/ai-settings \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "systemPrompt": "Voce atende a {tenantName}. Use apenas este contexto:\n{context}",
    "model": "google/gemma-3n-e4b",
    "temperature": 0.1,
    "toolCallingEnabled": false
  }'
```

Variaveis suportadas no prompt:

- `{tenantName}`
- `{context}`

## Testes e qualidade

```bash
npm run typecheck
npm test
```

Smoke test completo com Docker:

```bash
./scripts/test-flows.sh
```

Por padrao, o script usa o fallback local deterministico para nao depender de OpenAI/LM Studio. O modo pode ser escolhido explicitamente:

```bash
REPLY_MODE=deterministic ./scripts/test-flows.sh
REPLY_MODE=lmstudio ./scripts/test-flows.sh
REPLY_MODE=openai OPENAI_API_KEY=sk-... ./scripts/test-flows.sh
```

Cobertura atual:

- assinatura do webhook
- parsing de payload da Meta
- handshake `GET /webhook`
- regras de idempotencia async
- job id compativel com BullMQ
- retrieval da knowledge base
- validacao do template LangChain por tenant

## Decisoes tecnicas

As decisoes e trade-offs atuais estao em [DECISIONS.md](DECISIONS.md).

Resumo:

- webhook responde rapido e nao chama LLM
- processamento async por BullMQ/Redis
- fila unica com particionamento logico por tenant
- idempotencia no banco e no job id
- prompt de sistema configuravel por tenant em `tenant_ai_settings`
- LangChain com `ChatPromptTemplate` e `MessagesPlaceholder`
- API REST autenticada por JWT
