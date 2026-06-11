# Plano Final de Implementacao

## Objetivo

Construir um backend em Node.js + TypeScript para atendimento via WhatsApp com IA, com:

- webhook da Meta validado por assinatura
- persistencia de contatos, conversas e mensagens
- processamento assincrono desacoplado do webhook
- isolamento logico por tenant
- integracao com OpenAI via LangChain
- API REST autenticada por JWT
- resiliencia, idempotencia e observabilidade

## Decisoes Fechadas

### Stack principal

- **Runtime**: Node.js 20+
- **Linguagem**: TypeScript
- **HTTP**: Fastify
- **Banco**: PostgreSQL
- **ORM**: Drizzle ORM
- **Fila**: BullMQ com Redis
- **LLM orchestration**: LangChain
- **Logs**: Pino
- **Validacao**: Zod
- **Testes**: Vitest

### Decisoes de arquitetura

- **Fila unica com particionamento logico por tenant**
  - uma fila BullMQ unica, por exemplo `inbound-messages`
  - todos os jobs carregam `tenantId`
  - isolamento e observabilidade por tenant feitos via payload, logs e regras de processamento

- **Webhook rapido**
  - o `POST /webhook` valida assinatura, persiste a mensagem inbound, enfileira o job e responde `200` rapidamente
  - nenhuma chamada a OpenAI acontece no handler HTTP

- **Idempotencia no banco**
  - `wa_message_id` unico por tenant em `messages`
  - se a Meta reenviar o mesmo evento, a persistencia falha por conflito controlado e o job nao e reenfileirado

- **Multi-tenant**
  - o webhook resolve o tenant a partir do canal configurado, nunca por input arbitrario do cliente
  - a API REST resolve o tenant via claim `tenantId` no JWT

- **Auth REST via JWT**
  - `Authorization: Bearer <token>`
  - claims minimas: `sub`, `tenantId`, `role`, `exp`
  - sem implementar fluxo completo de login neste desafio
  - tokens podem ser gerados por seed/script auxiliar

- **Worker unico com particionamento logico**
  - um processo worker consumindo a fila unica
  - controle de concorrencia e ordenacao por tenant/conversa tratado na aplicacao

- **LangChain sem agente aberto**
  - usar LangChain para retrieval + prompt + tool calling
  - evitar agent loop generico
  - priorizar comportamento previsivel e defensavel

- **Function calling**
  - ferramenta inicial: `consultar_status_pedido(protocol: PED-XXXX)`
  - resposta deterministica por servico mock interno

## Arquitetura Proposta

```text
Cliente WhatsApp
  -> Meta Mock
    -> POST /webhook
      -> valida assinatura
      -> resolve tenant
      -> persiste inbound
      -> enqueue job na fila unica
      -> HTTP 200

BullMQ / Redis
  -> Worker
    -> carrega conversa + historico
    -> recupera contexto relevante da knowledge base
    -> chama LangChain/OpenAI
    -> opcionalmente executa tool calling
    -> persiste outbound
    -> envia resposta para Meta Mock
```

## Modelagem de Dados

### Tabelas principais

#### `tenants`

- `id`
- `name`
- `apiKey` ou identificador interno opcional
- `createdAt`

#### `tenant_channels`

Mapeia canais WhatsApp por tenant.

- `id`
- `tenantId`
- `provider`
- `phoneNumberId`
- `wabaId`
- `verifyToken`
- `createdAt`

#### `contacts`

- `id`
- `tenantId`
- `waId`
- `name`
- `createdAt`
- `updatedAt`

Constraint sugerida:

- unico em `(tenantId, waId)`

#### `conversations`

- `id`
- `tenantId`
- `contactId`
- `status`
- `lastMessageAt`
- `createdAt`
- `updatedAt`

Constraint sugerida:

- indice em `(tenantId, contactId)`

#### `messages`

- `id`
- `tenantId`
- `conversationId`
- `contactId`
- `waMessageId`
- `direction` (`inbound` | `outbound`)
- `body`
- `status`
- `providerPayload`
- `createdAt`

Constraints sugeridas:

- unico em `(tenantId, waMessageId)` para inbound da Meta
- indices em `(tenantId, conversationId, createdAt)`

### Tabela opcional

#### `webhook_events`

Util para auditoria do payload bruto e troubleshooting.

- `id`
- `tenantId`
- `provider`
- `eventType`
- `signature`
- `rawBody`
- `processedAt`
- `createdAt`

## Componentes e Responsabilidades

### 1. Camada HTTP

Responsabilidades:

- subir o servidor Fastify
- expor `GET /webhook`
- expor `POST /webhook`
- expor `GET /conversations`
- expor `GET /conversations/:id/messages`
- aplicar autenticacao JWT na API REST

### 2. Modulo de webhook

Responsabilidades:

- verificar handshake da Meta
- capturar `rawBody`
- validar `X-Hub-Signature-256`
- extrair `phone_number_id`, `waba_id`, `wa_message_id`, remetente e texto
- resolver tenant
- persistir mensagem inbound com idempotencia
- publicar job na fila

### 3. Modulo de fila

Responsabilidades:

- encapsular `Queue`, `Worker` e configuracao BullMQ
- produzir jobs com payload minimo
- configurar retry, backoff e limites

Payload sugerido:

```ts
type ProcessInboundMessageJob = {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  waMessageId: string;
};
```

### 4. Worker de processamento

Responsabilidades:

- buscar mensagem e conversa
- carregar historico relevante
- obter contexto da knowledge base
- executar cadeia LangChain
- persistir resposta outbound
- enviar resposta ao mock da Meta
- registrar falhas com retry

### 5. Modulo de IA

Responsabilidades:

- carregar e indexar os arquivos de `knowledge-base/`
- recuperar chunks relevantes
- montar prompt do sistema
- chamar OpenAI via LangChain
- controlar tool calling

Regras do prompt:

- responder apenas com base na knowledge base e nas tools disponiveis
- quando a informacao nao existir, responder explicitamente que nao sabe
- nao inventar planos, SLA, cobertura, procedimentos ou status

### 6. Integracao Meta

Responsabilidades:

- enviar mensagem outbound para `POST /{phoneNumberId}/messages`
- mapear resposta do mock para persistencia de status
- aplicar retry em falhas transientes

### 7. API REST

Responsabilidades:

- listar conversas do tenant autenticado
- listar mensagens de uma conversa do tenant autenticado
- garantir filtro por `tenantId` do JWT

## Estrategia de Particionamento Logico por Tenant

Embora exista apenas uma fila fisica, todos os jobs carregam `tenantId` e o sistema deve usar isso para:

- filtrar dados no banco
- propagar contexto nos logs
- medir throughput e falhas por tenant
- aplicar controles futuros de prioridade ou rate limiting

### Controle de concorrencia

Risco:

- duas mensagens da mesma conversa podem ser processadas em paralelo

Mitigacao recomendada:

- worker com concorrencia conservadora no inicio
- lock logico por `conversationId` ou `tenantId + conversationId`
- se o lock falhar, reenqueue curto ou retry controlado

Para o desafio, a abordagem mais equilibrada e:

- concorrencia baixa no worker
- lock por conversa

## Fluxo de Processamento

### Recebimento do webhook

1. receber `POST /webhook`
2. validar assinatura HMAC SHA-256 sobre o corpo cru
3. resolver tenant pelo canal WhatsApp configurado
4. criar ou localizar contato
5. criar ou localizar conversa
6. inserir mensagem inbound com restricao unica por `wa_message_id`
7. se a insercao for nova, enfileirar job
8. responder `200`

### Processamento do job

1. carregar mensagem inbound e historico da conversa
2. recuperar contexto relevante da knowledge base
3. chamar LangChain/OpenAI com prompt + historico + contexto
4. se necessario, executar `consultar_status_pedido`
5. persistir mensagem outbound
6. enviar outbound para Meta mock
7. atualizar status de envio

## LangChain: desenho proposto

### Componentes

- `ChatOpenAI`
- `OpenAIEmbeddings`
- `MemoryVectorStore`
- `RecursiveCharacterTextSplitter`
- tool binding para `consultar_status_pedido`

### Estrategia

- indexar a knowledge base na inicializacao do worker
- fazer retrieval por similaridade antes da chamada ao modelo
- limitar contexto enviado para controlar custo e previsibilidade
- usar tool calling explicito para consulta de pedido

### Motivo para nao usar agente generico

- menos imprevisibilidade
- menor superficie de falha
- mais facil de testar
- mais facil de defender em entrevista

## JWT: desenho proposto

### Claims

```json
{
  "sub": "user-123",
  "tenantId": "tenant-abc",
  "role": "admin",
  "exp": 9999999999
}
```

### Regras

- o middleware valida assinatura e expiracao
- `tenantId` vem exclusivamente do token
- todas as queries REST filtram por `tenantId`

### Escopo

- nao implementar login completo
- fornecer seed/script para emitir JWTs de teste

## Observabilidade

### Logs estruturados

Campos que devem aparecer com frequencia:

- `tenantId`
- `conversationId`
- `messageId`
- `waMessageId`
- `jobId`
- `phoneNumberId`

### Eventos importantes para log

- webhook recebido
- assinatura invalida
- mensagem duplicada
- job publicado
- job iniciado
- contexto recuperado
- chamada LLM iniciada/finalizada
- tool calling executado
- envio para Meta iniciado/finalizado
- retry
- falha terminal

## Resiliencia

### Retry

Aplicar retry com backoff exponencial em:

- falhas na OpenAI
- falhas na chamada ao mock da Meta
- falhas transientes de rede

### Nao aplicar retry cego em:

- assinatura invalida
- payload malformado
- erro permanente de validacao

## Estrutura Sugerida de Pastas

```text
src/
  app/
    server.ts
    routes/
    middleware/
  db/
    client.ts
    schema.ts
    migrations/
  lib/
    config.ts
    logger.ts
    errors.ts
  modules/
    auth/
    webhook/
    tenants/
    contacts/
    conversations/
    messages/
    queue/
    ai/
  integrations/
    meta/
    openai/
  worker/
    index.ts
    processors/
```

## Fases de Implementacao

### Fase 1 - Fundacao

- configurar Fastify
- configurar Drizzle
- configurar Pino
- configurar BullMQ
- configurar leitura de ambiente

### Fase 2 - Banco e dominio

- modelar schema
- criar migrations
- seed inicial de tenants e canais
- repositorios/servicos basicos

### Fase 3 - Webhook

- handshake `GET /webhook`
- captura de raw body
- validacao de assinatura
- persistencia inbound com idempotencia
- enqueue

### Fase 4 - Worker

- consumidor BullMQ
- historico de conversa
- retrieval na knowledge base
- chamada LangChain/OpenAI
- persistencia outbound
- envio para Meta mock

### Fase 5 - API REST

- middleware JWT
- `GET /conversations`
- `GET /conversations/:id/messages`

### Fase 6 - Hardening

- retries e backoff
- locks por conversa
- logs estruturados completos
- tratamento de erros consistente

### Fase 7 - Testes

Cobertura minima sugerida:

1. handshake de verificacao
2. assinatura valida
3. assinatura invalida
4. idempotencia de webhook
5. enqueue apenas em mensagem nova
6. filtro multi-tenant na REST API
7. worker responde com base na knowledge base
8. worker faz retry em falha externa

## Riscos e Mitigacoes

### Risco: respostas fora de ordem na mesma conversa

Mitigacao:

- lock logico por conversa
- concorrencia controlada

### Risco: crescimento de contexto da conversa

Mitigacao:

- limitar historico enviado
- resumir ou recortar historico se necessario

### Risco: alucinacao do modelo

Mitigacao:

- retrieval restrito
- prompt com instrucao explicita para nao inventar
- tools deterministicas para dados externos

### Risco: acoplamento excessivo no worker

Mitigacao:

- separar modulos de contexto, LLM, envio e persistencia

## Escopo Fora do Desafio

Itens que podem ficar para depois:

- painel administrativo
- fluxo real de login
- refresh token
- rate limiting por usuario
- DLQ dedicada
- metricas Prometheus
- embeddings persistidos em vector store externo
- painel de reprocessamento manual

## Resumo Executivo

O plano final prioriza entrega correta e defensavel:

- Fastify + Drizzle + PostgreSQL
- BullMQ com fila unica e particionamento logico por tenant
- JWT na API REST
- LangChain para retrieval e tool calling controlado
- idempotencia no banco
- worker desacoplado do webhook
- foco em previsibilidade, testes e logs
