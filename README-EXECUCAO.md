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

O fluxo recomendado roda backend e worker no host, entao LM Studio deve usar `OPENAI_BASE_URL=http://127.0.0.1:1234`.

## Rodando com infra em Docker e app no host

Este e o modo recomendado para desenvolvimento, smoke tests e LM Studio. Docker sobe Postgres, Redis e LocalStack; backend, worker e mock da Meta rodam no host.

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis localstack
```

O compose sobe:

- Postgres em `localhost:5432`
- Redis em `localhost:6379`
- LocalStack em `localhost:4566`

Depois rode migrations, backend, worker e mock no host.

```bash
npm run db:migrate
npm run dev
```

Em outro terminal:

```bash
npm run worker
```

Em outro terminal:

```bash
cd mock-meta-server
CANDIDATE_WEBHOOK_URL=http://localhost:8000/webhook npm start
```

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
npm run dev
npm run worker
cd mock-meta-server && npm start
```

Parar o ambiente:

```bash
docker compose down
```

Para apagar tambem o volume do Postgres:

```bash
docker compose down -v
```

## Rodando somente a infraestrutura Docker

Se preferir subir explicitamente apenas os servicos de apoio:

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis localstack
```

Em seguida, aplique migrations e rode backend, worker e mock no host:

```bash
npm run db:migrate
npm run dev
```

Em outro terminal:

```bash
npm run worker
```

```bash
cd mock-meta-server
CANDIDATE_WEBHOOK_URL=http://localhost:8000/webhook npm start
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

O mock da Meta tambem precisa estar rodando:

```bash
cd mock-meta-server
CANDIDATE_WEBHOOK_URL=http://localhost:8000/webhook npm start
```

## Modos de resposta

O worker forma a resposta sempre por uma LLM. As opcoes suportadas sao LM Studio e OpenAI.

A `knowledge-base/` entra inteira como contexto do `systemPrompt`; nao ha mais fallback deterministico nem recuperacao lexical por pergunta.

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

Como backend e worker rodam no host, use `OPENAI_BASE_URL=http://127.0.0.1:1234`. Se voce decidir rodar backend/worker dentro de Docker por conta propria, `127.0.0.1` passa a ser o container, e nesse caso seria necessario usar `host.docker.internal`.

Para modelos locais, mantenha:

```env
LLM_TOOL_CALLING_ENABLED=false
LLM_REQUEST_TIMEOUT_MS=600000
```

Smoke test:

```bash
REPLY_MODE=lmstudio ./scripts/test-flows.sh
```

O script valida primeiro `GET /v1/models` a partir do host. Se essa checagem falhar, o LM Studio nao esta servindo a API OpenAI-compatible na URL configurada.

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

Tambem funciona deixando a chave no `.env`; o modo ainda deve ser informado explicitamente:

```bash
REPLY_MODE=openai ./scripts/test-flows.sh
```

No modo `openai`, o script limpa `OPENAI_BASE_URL` por padrao para usar a API oficial da OpenAI. Se voce precisar testar outro endpoint OpenAI-compatible, use `REPLY_MODE=lmstudio` ou defina explicitamente `OPENAI_BASE_URL_OVERRIDE`.

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

Smoke test completo com infra Docker e app/mock no host:

```bash
./scripts/test-flows.sh
```

O script sobe Postgres/Redis/LocalStack via Docker por padrao, mas executa backend, worker e mock no host. Se voce ja tem Postgres e Redis locais:

```bash
USE_DOCKER_INFRA=false ./scripts/test-flows.sh
```

O modo de resposta do smoke test deve ser escolhido explicitamente:

```bash
REPLY_MODE=lmstudio ./scripts/test-flows.sh
REPLY_MODE=openai OPENAI_API_KEY=sk-... ./scripts/test-flows.sh
```

Use `REPLY_MODE=lmstudio` quando quiser testar um servidor local OpenAI-compatible, como LM Studio em `http://127.0.0.1:1234`.

Use `REPLY_MODE=openai` quando quiser testar a API oficial da OpenAI. A chave pode ser passada inline ou estar no `.env`.

Cobertura atual:

- assinatura do webhook
- parsing de payload da Meta
- handshake `GET /webhook`
- regras de idempotencia async
- job id compativel com BullMQ
- carregamento da knowledge base para contexto da LLM
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
