# Decisoes do Projeto

Este arquivo registra o estado atual da implementacao e as decisoes tecnicas que guiam o sistema.

## Stack atual

- **Node.js + TypeScript** como runtime e linguagem principal.
- **Fastify** para HTTP.
- **PostgreSQL + Drizzle ORM** para persistencia.
- **BullMQ + Redis** para processamento assincrono.
- **Fila unica `inbound-messages` com particionamento logico por tenant**.
- **JWT** para autenticar a API REST.
- **LangChain + ChatOpenAI** para a camada de LLM.
- **Pino** para logs estruturados.
- **Zod** para validacao de payloads e configuracoes.
- **Vitest** para testes automatizados.

## Fluxo implementado

```text
Meta Mock
  -> POST /webhook
    -> valida X-Hub-Signature-256 com raw body
    -> resolve tenant pelo phone_number_id do canal
    -> persiste contato, conversa e mensagem inbound
    -> aplica idempotencia por tenant + wa_message_id
    -> publica job na fila BullMQ
    -> responde 200 rapidamente

BullMQ / Redis
  -> worker
    -> carrega mensagem, conversa e historico
    -> recupera contexto da knowledge-base
    -> carrega tenant_ai_settings
    -> monta ChatPromptTemplate do LangChain
    -> chama LLM OpenAI/OpenAI-compatible
    -> persiste outbound com chave de idempotencia
    -> envia resposta para o mock da Meta
```

## Multi-tenant

- O webhook nao recebe `tenantId` do cliente.
- O tenant e resolvido a partir de `tenant_channels.phone_number_id`.
- Todas as entidades principais carregam `tenantId`.
- A API REST usa o `tenantId` vindo do JWT.
- Queries de conversas e mensagens filtram por tenant autenticado.
- Jobs da fila carregam `tenantId`, `conversationId`, `inboundMessageId` e `waMessageId`.

## Fila e workers

Foi escolhida uma fila BullMQ unica, `inbound-messages`, com particionamento logico por `tenantId`.

Motivos:

- Menor complexidade operacional para o desafio.
- Um unico worker pool consegue processar todos os tenants.
- Observabilidade e isolamento sao feitos por payload, logs e filtros no banco.
- Evita criar infraestrutura dinamica por tenant.

Trade-off:

- Em producao com muitos tenants ou SLAs diferentes, pode fazer sentido evoluir para filas por classe de servico, prioridades por tenant ou quotas por tenant.

## Idempotencia

- Mensagens inbound da Meta usam indice unico parcial em `(tenant_id, wa_message_id)`.
- Jobs usam `jobId` deterministico no formato `tenantId__waMessageId`.
- Mensagens outbound de resposta usam `idempotency_key` por tenant.
- O worker verifica se ja existe resposta outbound para o inbound antes de gerar e enviar outra.
- O status da mensagem inbound controla reprocessamento: `received`, `enqueued`, `processing`, `responded`, `failed`.

## Concorrencia

- O worker aplica um lock em memoria por conversa durante o processamento.
- Isso reduz respostas concorrentes no mesmo atendimento em execucao local ou single replica.

Limite conhecido:

- Em multiplas replicas, o lock em memoria nao e suficiente. A evolucao natural seria usar Redis lock, Postgres advisory lock ou particionamento da fila por chave de conversa.

## LLM e LangChain

O sistema usa LangChain com `ChatPromptTemplate` e `MessagesPlaceholder`.

Decisao atual:

- O prompt de sistema nao fica mais hardcoded no `ai-service`.
- A configuracao fica em `tenant_ai_settings`.
- O template aceita variaveis controladas:
  - `{tenantName}`
  - `{context}`
- O historico da conversa entra via `MessagesPlaceholder("history")`.
- O modelo, temperatura e uso de tool calling podem ser sobrescritos por tenant.
- Se nao houver configuracao especifica no tenant, o sistema usa os defaults globais do `.env`.

Isso foi escolhido porque e o caminho mais defensavel com LangChain:

- Mantem prompt, contexto e historico como partes tipadas da cadeia.
- Evita concatenacao manual de mensagens.
- Permite parametrizar o comportamento por tenant sem mudar codigo.
- Facilita evoluir para prompt versionado, LangSmith, vector stores ou chains mais elaboradas.

## Configuracao de IA por tenant

Tabela atual:

- `tenant_ai_settings.tenant_id`
- `tenant_ai_settings.system_prompt`
- `tenant_ai_settings.model`
- `tenant_ai_settings.temperature`
- `tenant_ai_settings.tool_calling_enabled`
- `tenant_ai_settings.created_at`
- `tenant_ai_settings.updated_at`

Endpoints autenticados:

- `GET /tenant/ai-settings`
- `PATCH /tenant/ai-settings`

O `PATCH` valida o template antes de persistir. Prompts com variaveis nao suportadas retornam `400`.

## LM Studio

O projeto suporta endpoints OpenAI-compatible via:

- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_API_KEY`
- `LLM_TOOL_CALLING_ENABLED`

Para LM Studio no host:

- Rodando backend/worker no host: use `OPENAI_BASE_URL=http://127.0.0.1:1234`.
- Rodando backend/worker no Docker: use `OPENAI_BASE_URL=http://host.docker.internal:1234`.
- Para modelos locais que nao suportam tool calling de forma compativel, use `LLM_TOOL_CALLING_ENABLED=false`.

## API REST

Endpoints atuais:

- `GET /conversations`
- `GET /conversations/:id/messages`
- `GET /tenant/ai-settings`
- `PATCH /tenant/ai-settings`

Autenticacao:

- `Authorization: Bearer <token>`
- Claims esperadas: `sub`, `tenantId`, `role`, `exp`.
- Nao ha fluxo completo de login; o projeto fornece `npm run token:dev`.

## Persistencia

Tabelas principais:

- `tenants`
- `tenant_channels`
- `tenant_ai_settings`
- `contacts`
- `conversations`
- `messages`
- `webhook_events`

Drizzle migrations atuais:

- `0000_salty_echo.sql`
- `0001_smiling_tombstone.sql`
- `0002_short_the_call.sql`

## Knowledge base

- A recuperacao atual e lexical sobre arquivos em `knowledge-base/`.
- Para a base pequena do desafio, essa escolha e previsivel e suficiente.
- Uma evolucao natural seria persistir embeddings por tenant e usar vector search.

## Tool calling

Foi implementada a ferramenta:

- `consultar_status_pedido(protocol: PED-XXXX)`

Ela retorna dados deterministicas em memoria para demonstrar o fluxo de tool calling sem depender de servico externo.

## Observabilidade

- Logs estruturados com Pino.
- Logs incluem `tenantId`, `conversationId`, `waMessageId`, `queueName`, modelo usado e status relevantes.
- O mock da Meta permite consultar envios em `GET /sent`.

## Limites conscientes

- Login real e gestao de usuarios ficaram fora do escopo.
- Lock distribuido por conversa ainda nao foi implementado.
- DLQ dedicada ainda nao foi implementada alem dos retries do BullMQ.
- Retrieval semantico com embeddings ficou fora do escopo.
- Controle de quotas/custo por tenant ainda nao foi implementado.
- Prompt versionado por tenant ainda nao foi implementado.
- O fallback local sem LLM ainda e simples e nao passa por uma cadeia LangChain.
