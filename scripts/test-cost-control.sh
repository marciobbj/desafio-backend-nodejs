#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE="${COMPOSE:-docker compose}"
USE_DOCKER_INFRA="${USE_DOCKER_INFRA:-true}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
MOCK_URL="${MOCK_URL:-http://localhost:8001}"
BACKEND_LOG="/tmp/desafio-backend-cost-control-backend.log"
WORKER_LOG="/tmp/desafio-backend-cost-control-worker.log"
MOCK_LOG="/tmp/desafio-backend-cost-control-mock.log"
PHONE="${SMOKE_PHONE:-5511999990000}"
REPLY_MODE="${REPLY_MODE:-}"
LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-google/gemma-3n-e4b}"

read_dotenv_value() {
  local name="$1"
  local line

  if [[ ! -f .env ]]; then
    return 1
  fi

  line="$(grep -E "^[[:space:]]*${name}=" .env | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  local value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf "%s" "$value"
}

export_env_if_unset() {
  local name="$1"
  local value

  if [[ -n "${!name:-}" ]]; then
    return 0
  fi

  value="$(read_dotenv_value "$name" || true)"
  if [[ -n "$value" ]]; then
    export "$name=$value"
  fi
}

is_placeholder_openai_key() {
  [[ -z "${1:-}" || "$1" == "sk-proj-troque-pela-sua-chave" ]]
}

if [[ ! -f .env ]]; then
  echo "Criando .env a partir de .env.example"
  cp .env.example .env
fi

for env_name in OPENAI_API_KEY OPENAI_MODEL OPENAI_BASE_URL LLM_TOOL_CALLING_ENABLED LLM_REQUEST_TIMEOUT_MS; do
  export_env_if_unset "$env_name"
done

export OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
export LLM_REQUEST_TIMEOUT_MS="${LLM_REQUEST_TIMEOUT_MS:-600000}"

case "$REPLY_MODE" in
  lmstudio)
    export OPENAI_API_KEY="${LMSTUDIO_API_KEY:-lm-studio}"
    export OPENAI_MODEL="$LMSTUDIO_MODEL"
    export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:1234}"
    export LLM_TOOL_CALLING_ENABLED="${LLM_TOOL_CALLING_ENABLED:-false}"
    RESPONSE_TIMEOUT_SECONDS="${SMOKE_RESPONSE_TIMEOUT_SECONDS:-240}"
    ;;
  openai)
    if is_placeholder_openai_key "${OPENAI_API_KEY:-}"; then
      echo "REPLY_MODE=openai exige OPENAI_API_KEY real no ambiente ou no .env." >&2
      exit 1
    fi
    export OPENAI_BASE_URL="${OPENAI_BASE_URL_OVERRIDE:-}"
    export OPENAI_MODEL
    export LLM_TOOL_CALLING_ENABLED="${LLM_TOOL_CALLING_ENABLED:-true}"
    RESPONSE_TIMEOUT_SECONDS="${SMOKE_RESPONSE_TIMEOUT_SECONDS:-180}"
    ;;
  *)
    if [[ -z "$REPLY_MODE" ]]; then
      echo "REPLY_MODE e obrigatorio. Use REPLY_MODE=lmstudio ou REPLY_MODE=openai." >&2
    else
      echo "REPLY_MODE invalido: $REPLY_MODE. Use lmstudio ou openai." >&2
    fi
    exit 1
    ;;
esac

section() {
  printf "\n==> %s\n" "$1"
}

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" >/dev/null 2>&1; then
    kill "$MOCK_PID" >/dev/null 2>&1 || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi

  if [[ -n "${WORKER_PID:-}" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" 2>/dev/null || true
  fi

  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

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

require_cmd curl
require_cmd node
require_cmd npm
if [[ "$USE_DOCKER_INFRA" == "true" ]]; then
  require_cmd docker
fi

if [[ "$USE_DOCKER_INFRA" == "true" ]]; then
  section "Subindo infraestrutura Docker"
  $COMPOSE up -d --remove-orphans postgres redis localstack
  $COMPOSE stop mock-meta >/dev/null 2>&1 || true
else
  section "Usando Postgres e Redis locais"
fi

section "Aplicando migrations no host"
npm run db:migrate

section "Iniciando mock Meta no host"
rm -f "$MOCK_LOG"
META_APP_SECRET="${META_APP_SECRET:-super-secret-app-secret-trocar}" \
CANDIDATE_WEBHOOK_URL="${CANDIDATE_WEBHOOK_URL:-http://localhost:8000/webhook}" \
node mock-meta-server/server.js >"$MOCK_LOG" 2>&1 &
MOCK_PID="$!"

section "Iniciando backend no host"
rm -f "$BACKEND_LOG" "$WORKER_LOG"
npm run dev >"$BACKEND_LOG" 2>&1 &
BACKEND_PID="$!"

section "Aguardando servicos"
wait_http "$BACKEND_URL/health" "backend"
wait_http "$MOCK_URL/health" "mock-meta"

section "Iniciando worker no host"
npm run worker >"$WORKER_LOG" 2>&1 &
WORKER_PID="$!"
sleep 2

section "Gerando JWT de desenvolvimento"
TOKEN="$(npm run token:dev | tail -n 1 | tr -d '\r')"

section "Configurando Orçamento Inicial (Liberado: 0.01 USD, Gasto: 0.00 USD)"
curl -fsS -X PATCH "$BACKEND_URL/tenant/ai-settings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"monthlyBudgetUsd": 0.01, "currentMonthSpendUsd": 0.00}'
printf "\n"

section "Testando Mensagem 1 - Orçamento Liberado"
BEFORE_COUNT="$(sent_count)"
MSG_ID_1="wamid.cost1.$(date +%s)"

curl -fsS -X POST "$MOCK_URL/simulate/inbound" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$PHONE\",\"text\":\"Quais sao os planos de voces?\",\"id\":\"$MSG_ID_1\"}"
printf "\n"

echo "Aguardando resposta da LLM..."
AFTER_COUNT="$BEFORE_COUNT"
for _ in $(seq 1 "$RESPONSE_TIMEOUT_SECONDS"); do
  AFTER_COUNT="$(sent_count)"
  if (( AFTER_COUNT > BEFORE_COUNT )); then
    break
  fi
  sleep 1
done

if (( AFTER_COUNT <= BEFORE_COUNT )); then
  echo "ERRO: Não recebemos resposta da LLM com orçamento liberado." >&2
  exit 1
fi
echo "Resposta 1 recebida com sucesso."

section "Atualizando Orçamento para Bloqueado (Gasto >= Limite: 0.02 >= 0.01 USD)"
curl -fsS -X PATCH "$BACKEND_URL/tenant/ai-settings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentMonthSpendUsd": 0.02}'
printf "\n"

section "Testando Mensagem 2 - Orçamento Bloqueado"
BEFORE_COUNT_2="$(sent_count)"
MSG_ID_2="wamid.cost2.$(date +%s)"

curl -fsS -X POST "$MOCK_URL/simulate/inbound" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$PHONE\",\"text\":\"Qual o horario de atendimento?\",\"id\":\"$MSG_ID_2\"}"
printf "\n"

echo "Aguardando resposta bloqueada..."
AFTER_COUNT_2="$BEFORE_COUNT_2"
for _ in $(seq 1 15); do
  AFTER_COUNT_2="$(sent_count)"
  if (( AFTER_COUNT_2 > BEFORE_COUNT_2 )); then
    break
  fi
  sleep 1
done

if (( AFTER_COUNT_2 <= BEFORE_COUNT_2 )); then
  echo "ERRO: Não recebemos a resposta de bloqueio/fallback dentro de 15s." >&2
  exit 1
fi

section "Validando se a resposta foi o fallback de bloqueio"
LAST_SENT_BODY="$(curl -fsS "$MOCK_URL/sent" | node -e "
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  const list = JSON.parse(data).sent;
  const last = list[list.length - 1];
  console.log(last.text);
});
")"

echo "Corpo da última mensagem enviada: \"$LAST_SENT_BODY\""

FALLBACK_EXPECTED="Desculpe, o limite de processamento de mensagens foi atingido. Por favor, tente novamente mais tarde."

if [[ "$LAST_SENT_BODY" != "$FALLBACK_EXPECTED" ]]; then
  echo "ERRO: A resposta enviada não corresponde ao fallback esperado de limite de gastos!" >&2
  exit 1
fi

section "SUCESSO: Teste de controle de custo concluído com sucesso!"
echo "O uso foi corretamente travado quando o limite de gastos foi superado."
exit 0
