#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE="${COMPOSE:-docker compose}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
MOCK_URL="${MOCK_URL:-http://localhost:8001}"
PHONE="${SMOKE_PHONE:-5511999990000}"
MESSAGE_ID="${SMOKE_MESSAGE_ID:-wamid.smoke.$(date +%s)}"
REPLY_MODE="${REPLY_MODE:-deterministic}"
LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-google/gemma-3n-e4b}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
LLM_REQUEST_TIMEOUT_MS="${LLM_REQUEST_TIMEOUT_MS:-600000}"

case "$REPLY_MODE" in
  deterministic)
    export OPENAI_API_KEY="sk-proj-troque-pela-sua-chave"
    export OPENAI_BASE_URL=""
    export LLM_TOOL_CALLING_ENABLED="false"
    RESPONSE_TIMEOUT_SECONDS="${SMOKE_RESPONSE_TIMEOUT_SECONDS:-60}"
    REPLY_PATH="deterministico"
    REPLY_DESCRIPTION="Sem LLM configurada: worker usa retrieveKnowledge() e generateLocalReply() para responder a partir da knowledge-base."
    ;;
  lmstudio)
    export OPENAI_API_KEY="${OPENAI_API_KEY:-lm-studio}"
    export OPENAI_MODEL="$LMSTUDIO_MODEL"
    export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://host.docker.internal:1234}"
    if [[ "$OPENAI_BASE_URL" == "http://127.0.0.1:1234" || "$OPENAI_BASE_URL" == "http://localhost:1234" ]]; then
      export OPENAI_BASE_URL="http://host.docker.internal:1234"
    fi
    export LLM_TOOL_CALLING_ENABLED="${LLM_TOOL_CALLING_ENABLED:-false}"
    export LLM_REQUEST_TIMEOUT_MS
    RESPONSE_TIMEOUT_SECONDS="${SMOKE_RESPONSE_TIMEOUT_SECONDS:-240}"
    REPLY_PATH="lmstudio"
    REPLY_DESCRIPTION="LLM local OpenAI-compatible: worker monta ChatPromptTemplate, chama ChatOpenAI apontando para LM Studio e usa modelo $OPENAI_MODEL."
    ;;
  openai)
    if [[ -z "${OPENAI_API_KEY:-}" || "$OPENAI_API_KEY" == "sk-proj-troque-pela-sua-chave" ]]; then
      echo "REPLY_MODE=openai exige OPENAI_API_KEY real no ambiente." >&2
      exit 1
    fi
    export OPENAI_BASE_URL="${OPENAI_BASE_URL:-}"
    export OPENAI_MODEL
    export LLM_TOOL_CALLING_ENABLED="${LLM_TOOL_CALLING_ENABLED:-true}"
    export LLM_REQUEST_TIMEOUT_MS
    RESPONSE_TIMEOUT_SECONDS="${SMOKE_RESPONSE_TIMEOUT_SECONDS:-180}"
    REPLY_PATH="openai"
    REPLY_DESCRIPTION="OpenAI externa: worker monta ChatPromptTemplate, chama ChatOpenAI na API OpenAI e pode usar tool calling conforme LLM_TOOL_CALLING_ENABLED."
    ;;
  *)
    echo "REPLY_MODE invalido: $REPLY_MODE. Use deterministic, lmstudio ou openai." >&2
    exit 1
    ;;
esac

echo "[resposta] modo: $REPLY_PATH"
echo "[resposta] caminho: $REPLY_DESCRIPTION"
echo "[resposta] OPENAI_MODEL=${OPENAI_MODEL:-nao-aplicavel}"
echo "[resposta] OPENAI_BASE_URL=${OPENAI_BASE_URL:-openai-default-ou-vazio}"
echo "[resposta] LLM_TOOL_CALLING_ENABLED=${LLM_TOOL_CALLING_ENABLED:-nao-definido}"
echo "[resposta] LLM_REQUEST_TIMEOUT_MS=${LLM_REQUEST_TIMEOUT_MS:-nao-definido}"
echo "[resposta] timeout aguardando outbound=${RESPONSE_TIMEOUT_SECONDS}s"

section() {
  printf "\n==> %s\n" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  fi
}

json_get() {
  node -e "
const path = process.argv[1].split('.');
let data = '';
process.stdin.on('data', (chunk) => data += chunk);
process.stdin.on('end', () => {
  const parsed = JSON.parse(data);
  let value = parsed;
  for (const key of path) value = value?.[key];
  if (value === undefined || value === null) process.exit(2);
  if (typeof value === 'object') console.log(JSON.stringify(value));
  else console.log(value);
});
" "$1"
}

wait_http() {
  local url="$1"
  local label="$2"
  local max_attempts="${3:-60}"

  for attempt in $(seq 1 "$max_attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$label pronto em $url"
      return 0
    fi
    sleep 1
  done

  echo "Timeout aguardando $label em $url" >&2
  exit 1
}

sent_count() {
  curl -fsS "$MOCK_URL/sent" | json_get count
}

print_json() {
  local title="$1"
  local url="$2"
  section "$title"
  curl -fsS "$url"
  printf "\n"
}

require_cmd docker
require_cmd curl
require_cmd node
require_cmd npm

if [[ ! -f .env ]]; then
  section "Criando .env a partir de .env.example"
  cp .env.example .env
fi

section "Instalando dependencias locais quando necessario"
if [[ ! -d node_modules ]]; then
  npm ci
else
  echo "node_modules ja existe; pulando npm ci"
fi

section "Buildando e subindo containers"
$COMPOSE up -d --build postgres redis backend worker mock-meta

section "Aguardando servicos"
wait_http "$BACKEND_URL/health" "backend"
wait_http "$MOCK_URL/health" "mock-meta"

print_json "Health backend" "$BACKEND_URL/health"
print_json "Health mock-meta" "$MOCK_URL/health"

if [[ "$REPLY_MODE" == "lmstudio" ]]; then
  section "Validando acesso do container ao LM Studio"
  $COMPOSE exec -T backend node - "$OPENAI_BASE_URL" <<'NODE'
const rawBaseUrl = process.argv[2];
const baseUrl = rawBaseUrl.replace(/\/$/, "");
const modelsUrl = `${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/models`;

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);

try {
  const response = await fetch(modelsUrl, { signal: controller.signal });
  const body = await response.text();
  if (!response.ok) {
    console.error(`LM Studio respondeu HTTP ${response.status} em ${modelsUrl}`);
    console.error(body.slice(0, 500));
    process.exit(1);
  }
  console.log(`LM Studio acessivel a partir do container: ${modelsUrl}`);
  console.log(body.slice(0, 500));
} catch (err) {
  console.error(`Nao consegui acessar LM Studio a partir do container em ${modelsUrl}.`);
  console.error("Se o backend/worker rodam no Docker, 127.0.0.1 aponta para o container.");
  console.error("Use OPENAI_BASE_URL=http://host.docker.internal:1234 e configure o LM Studio para aceitar conexoes fora de localhost, ou rode backend/worker no host.");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
NODE
fi

section "Caminho de geracao da resposta"
echo "Modo selecionado: $REPLY_PATH"
echo "$REPLY_DESCRIPTION"
case "$REPLY_MODE" in
  deterministic)
    echo "Fluxo: webhook -> BullMQ -> worker -> knowledge-base lexical -> generateLocalReply -> Meta mock"
    ;;
  lmstudio)
    echo "Fluxo: webhook -> BullMQ -> worker -> knowledge-base lexical -> tenant_ai_settings -> LangChain ChatPromptTemplate -> LM Studio ($OPENAI_BASE_URL) -> Meta mock"
    ;;
  openai)
    echo "Fluxo: webhook -> BullMQ -> worker -> knowledge-base lexical -> tenant_ai_settings -> LangChain ChatPromptTemplate -> OpenAI API -> Meta mock"
    ;;
esac

section "Garantindo dependencias compativeis dentro do container backend"
$COMPOSE exec -T backend npm install

section "Rodando typecheck dentro do container backend"
$COMPOSE exec -T backend npm run typecheck

section "Rodando testes dentro do container backend"
$COMPOSE exec -T backend npm test

section "Gerando JWT de desenvolvimento"
TOKEN="$($COMPOSE exec -T backend npm run token:dev | tail -n 1 | tr -d '\r')"
echo "TOKEN=$TOKEN"

section "Consultando configuracao de IA do tenant"
curl -fsS "$BACKEND_URL/tenant/ai-settings" \
  -H "Authorization: Bearer $TOKEN"
printf "\n"

section "Validando erro de template invalido"
INVALID_RESPONSE="$(
  curl -sS -w "\n%{http_code}" \
    -X PATCH "$BACKEND_URL/tenant/ai-settings" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"systemPrompt":"Use {variavelInvalida}"}'
)"
INVALID_STATUS="$(printf "%s" "$INVALID_RESPONSE" | tail -n 1)"
printf "%s\n" "$INVALID_RESPONSE" | sed '$d'
if [[ "$INVALID_STATUS" != "400" ]]; then
  echo "Esperava HTTP 400 para template invalido, recebi $INVALID_STATUS" >&2
  exit 1
fi

section "Simulando inbound via mock Meta"
BEFORE_COUNT="$(sent_count)"
echo "Envios antes do teste: $BEFORE_COUNT"
INBOUND_RESPONSE="$(
  curl -fsS -X POST "$MOCK_URL/simulate/inbound" \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"$PHONE\",\"text\":\"Quais sao os planos de voces?\",\"id\":\"$MESSAGE_ID\"}"
)"
echo "$INBOUND_RESPONSE"
DELIVERED="$(printf "%s" "$INBOUND_RESPONSE" | json_get delivered)"
if [[ "$DELIVERED" != "true" ]]; then
  echo "Webhook nao foi entregue com sucesso" >&2
  exit 1
fi

section "Aguardando worker enviar resposta outbound"
AFTER_COUNT="$BEFORE_COUNT"
for _ in $(seq 1 "$RESPONSE_TIMEOUT_SECONDS"); do
  AFTER_COUNT="$(sent_count)"
  if (( AFTER_COUNT > BEFORE_COUNT )); then
    break
  fi
  sleep 1
done

if (( AFTER_COUNT <= BEFORE_COUNT )); then
  echo "Worker nao enviou resposta outbound dentro de ${RESPONSE_TIMEOUT_SECONDS}s" >&2
  if [[ "$REPLY_MODE" == "lmstudio" ]]; then
    echo "Para modelos locais, confirme se o modelo ja terminou de carregar no LM Studio ou aumente SMOKE_RESPONSE_TIMEOUT_SECONDS/LLM_REQUEST_TIMEOUT_MS." >&2
  fi
  section "Logs backend"
  $COMPOSE logs --tail=80 backend
  section "Logs worker"
  $COMPOSE logs --tail=120 worker
  exit 1
fi
echo "Envios depois do processamento: $AFTER_COUNT"

print_json "Mensagens enviadas ao mock" "$MOCK_URL/sent"

section "Testando idempotencia com reentrega do mesmo message.id"
curl -fsS -X POST "$MOCK_URL/simulate/inbound" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$PHONE\",\"text\":\"Quais sao os planos de voces?\",\"id\":\"$MESSAGE_ID\"}"
printf "\n"
sleep 5
DUP_COUNT="$(sent_count)"
echo "Envios apos reentrega duplicada: $DUP_COUNT"
if (( DUP_COUNT != AFTER_COUNT )); then
  echo "Idempotencia falhou: contador saiu de $AFTER_COUNT para $DUP_COUNT" >&2
  exit 1
fi

section "Consultando conversas pela API REST"
CONVERSATIONS="$(
  curl -fsS "$BACKEND_URL/conversations" \
    -H "Authorization: Bearer $TOKEN"
)"
echo "$CONVERSATIONS"
CONVERSATION_ID="$(printf "%s" "$CONVERSATIONS" | json_get 0.id)"
echo "CONVERSATION_ID=$CONVERSATION_ID"

section "Consultando mensagens da conversa"
curl -fsS "$BACKEND_URL/conversations/$CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $TOKEN"
printf "\n"

section "Logs recentes do worker"
$COMPOSE logs --tail=80 worker

section "Smoke test concluido"
echo "Ambiente permanece rodando para inspecao."
echo "Para encerrar: docker compose down"
