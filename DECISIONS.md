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
    -> carrega contexto completo da knowledge-base
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
- Jobs usam `jobId` estavel no formato `tenantId__waMessageId`.
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

- O worker sempre gera resposta por LLM.
- O prompt de sistema nao fica mais hardcoded no `ai-service`.
- A configuracao fica em `tenant_ai_settings`.
- O template aceita variaveis controladas:
  - `{tenantName}`
  - `{context}`
- O `{context}` recebe a base `knowledge-base/` completa, carregada dos arquivos Markdown.
- O historico da conversa entra via `MessagesPlaceholder("history")`.
- O modelo, temperatura e uso de tool calling podem ser sobrescritos por tenant.
- Se nao houver configuracao especifica no tenant, o sistema usa os defaults globais do `.env`.
- Se nao houver LM Studio ou OpenAI configurado, o job falha e fica sujeito aos retries do BullMQ.

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

Para LM Studio:

- O fluxo operacional atual roda backend, worker e mock da Meta no host, enquanto Docker fica restrito a Postgres, Redis e LocalStack.
- Com backend/worker no host, use `OPENAI_BASE_URL=http://127.0.0.1:1234`.
- Essa escolha evita o problema de `127.0.0.1` dentro do container apontar para o proprio container em vez do host.
- Para modelos locais que nao suportam tool calling de forma compativel, use `LLM_TOOL_CALLING_ENABLED=false`.
- Modelos locais podem exigir timeouts maiores; o projeto expoe `LLM_REQUEST_TIMEOUT_MS` para configurar a chamada ao endpoint OpenAI-compatible.

Esta opcao foi adicionada por necessidade pratica durante a implementacao: testar o fluxo real de LLM sem depender de uma chave externa da OpenAI. A decisao foi manter a integracao passando pelo mesmo `ChatOpenAI` do LangChain, alterando apenas `OPENAI_BASE_URL`, em vez de criar um provider paralelo para modelo local.

Com isso existem dois caminhos suportados para formar a resposta:

- **LM Studio**: LLM local via endpoint OpenAI-compatible; o worker usa LangChain, `ChatPromptTemplate`, `tenant_ai_settings` e `ChatOpenAI` apontando para `OPENAI_BASE_URL`.
- **OpenAI**: API externa da OpenAI; o worker usa o mesmo fluxo LangChain e pode habilitar tool calling quando suportado.

Trade-offs:

- O LM Studio exercita o caminho LangChain/LLM sem custo externo, mas depende da capacidade e compatibilidade do modelo local.
- A OpenAI externa e o alvo principal de producao, mas exige credencial e pode gerar custo.
- O fallback local sem LLM foi removido para que smoke tests e execucoes reais exercitem sempre o caminho de LLM.

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

## Knowledge base (RAG com pgvector e Drizzle)

- **Busca Semântica:** A base em `knowledge-base/` agora é dividida em chunks e convertida em embeddings (vetores de 1536 dimensões) gerados via `OpenAIEmbeddings`.
- **Drizzle Nativo + pgvector:** Optamos por usar o suporte nativo a vetores do Drizzle ORM (`vector("embedding", { dimensions: 1536 })` no schema e `cosineDistance` nas queries), mantendo uma única pool de conexões com o banco (`postgres-js`) e preservando a integridade das migrations.
- **Multi-tenancy:** Cada chunk de documento é associado explicitamente a um `tenant_id` com chave estrangeira para a tabela `tenants`, garantindo isolamento estrito dos dados na busca vetorial.
- **Ingestão Dinâmica no Startup:** Os embeddings do tenant padrão são pré-populados no boot do servidor (`prepareRuntimeData`).
- **Mecanismo de Fallback Resiliente:** Se a geração de embeddings falhar (por exemplo, no desenvolvimento local usando LM Studio offline sem suporte a embeddings), o sistema captura a exceção, registra um log de aviso e reverte automaticamente para o carregamento estático completo da base para alimentar o prompt, mantendo o sistema em funcionamento sem erros fatais.

## Tool calling

Foi implementada a ferramenta:

- `consultar_status_pedido(protocol: PED-XXXX)`

Ela retorna dados estaticos em memoria para demonstrar o fluxo de tool calling sem depender de servico externo.

## Observabilidade

- Logs estruturados com Pino.
- Logs incluem `tenantId`, `conversationId`, `waMessageId`, `queueName`, modelo usado e status relevantes.
- O mock da Meta permite consultar envios em `GET /sent`.

## Cobertura de testes

A suite automatizada atual usa Vitest e cobre 20 cenarios em 9 arquivos de teste.

O foco da cobertura e proteger as regras de negocio e as fronteiras criticas do fluxo:

- assinatura HMAC do webhook da Meta;
- parsing de payload inbound da Meta;
- handshake `GET /webhook`;
- reentrega completa do mesmo webhook sem novo enqueue;
- resolucao de tenant por `tenant_channels.phone_number_id`;
- isolamento das rotas REST pelo `tenantId` autenticado;
- regras de idempotencia async e `jobId` estavel compativel com BullMQ;
- worker reaproveitando outbound pendente em retry;
- worker ignorando outbound ja enviado para nao duplicar resposta;
- falha no envio para a Meta propagando erro para permitir retry do BullMQ;
- carregamento da `knowledge-base/` como contexto da LLM;
- validacao do template LangChain por tenant.

Alguns testes de fluxo usam mocks nas bordas de banco, fila, LLM e Meta. Essa escolha mantem o `npm test` rapido, reprodutivel e sem depender de Postgres, Redis, LM Studio ou chave da OpenAI.

O smoke script complementa essa cobertura exercitando o caminho de ponta a ponta com infraestrutura real local: webhook, Postgres, Redis/BullMQ, worker, LLM via LM Studio/OpenAI e mock da Meta.

Limites atuais da cobertura:

- nao ha teste automatizado de integracao subindo Postgres e Redis dentro da suite;
- nao ha simulacao de multiplas replicas de worker;
- nao ha assercao automatizada de qualidade semantica da resposta da LLM;
- o caminho OpenAI/LM Studio real fica validado pelo smoke script, nao pela suite unit/integration rapida.

## Controle de Custos e Limites (Implementação Inicial e Expansão)

Implementamos um controle simplificado de orçamento mensal por tenant:
- Adicionamos as colunas opcionais `monthly_budget_usd` (orçamento máximo) e `current_month_spend_usd` (gasto acumulado) à tabela `tenant_ai_settings`.
- No serviço de IA (`generateReply`), validamos se o gasto acumulado atingiu ou superou o limite do tenant. Caso positivo, a chamada à LLM é abortada e uma resposta amigável de fallback é retornada instantaneamente, preservando tokens e custos.
- Testes unitários cobrem e asseguram esse comportamento em `src/test/cost-control.test.ts`.

### Como expandir para produção de forma robusta:
1. **Cálculo Real por Chamada**:
   - Extrair o consumo exato de tokens da resposta da LLM (`tokenUsage` no LangChain).
   - Multiplicar os tokens de entrada e saída pelos custos respectivos do modelo configurado e atualizar incrementalmente o campo `current_month_spend_usd` no banco.
2. **Histórico e Auditoria**:
   - Criar uma tabela `llm_usage_logs` para registrar o consumo individual de cada mensagem (tokens, modelo, custo individual e data) para prestação de contas.
3. **Alertas de Consumo**:
   - Disparar notificações por e-mail ou webhooks quando o consumo do tenant atingir limites de alerta (ex: 80% e 100% do orçamento).
4. **Cron Job de Limpeza**:
   - Configurar uma tarefa recorrente (BullMQ cron) para resetar o gasto acumulado (`current_month_spend_usd`) para `0` no primeiro dia de cada mês.

## Limites conscientes

- Login real e gestao de usuarios ficaram fora do escopo.
- Lock distribuido por conversa ainda nao foi implementado.
- DLQ dedicada ainda nao foi implementada alem dos retries do BullMQ.
- Retrieval semantico com embeddings ficou fora do escopo.
- Prompt versionado por tenant ainda nao foi implementado.
- Sem LM Studio ou chave OpenAI configurada, o job falha e fica sujeito aos retries do BullMQ.