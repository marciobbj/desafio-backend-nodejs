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

## LM Studio

No LM Studio:

1. Carregue o modelo `google/gemma-3n-e4b`.
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

Para modelos locais, mantenha:

```env
LLM_TOOL_CALLING_ENABLED=false
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
