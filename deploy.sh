#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${ROOT_DIR}/.deploy"
STACK_FILE="${DEPLOY_DIR}/docker-stack.yml"

STACK_NAME="${STACK_NAME:-timebomb}"
IMAGE_PREFIX="${IMAGE_PREFIX:-timebomb}"
TAG="${TAG:-latest}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
VITE_API_URL="${VITE_API_URL:-http://localhost:${BACKEND_PORT}}"

mkdir -p "${DEPLOY_DIR}"

if [[ -f "${ROOT_DIR}/backend/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/backend/.env"
  set +a
fi

ODSAY_API_KEY="${ODSAY_API_KEY:-}"
ODSAY_REFERER="${ODSAY_REFERER:-http://localhost:${FRONTEND_PORT}}"
KAKAO_REST_API_KEY="${KAKAO_REST_API_KEY:-}"

if [[ -z "${ODSAY_API_KEY}" ]]; then
  echo "Missing ODSAY_API_KEY. Add it to backend/.env or export it before deploy." >&2
  exit 1
fi

if [[ -z "${KAKAO_REST_API_KEY}" ]]; then
  echo "Missing KAKAO_REST_API_KEY. Add it to backend/.env or export it before deploy." >&2
  exit 1
fi

if ! docker info --format '{{.Swarm.LocalNodeState}}' >/tmp/timebomb-swarm-state 2>/dev/null; then
  echo "Docker is not available. Start Docker first." >&2
  exit 1
fi

if [[ "$(cat /tmp/timebomb-swarm-state)" != "active" ]]; then
  echo "Docker Swarm is not active. Initializing a single-node swarm..."
  docker swarm init
fi

cat >"${STACK_FILE}" <<EOF
version: "3.8"

services:
  frontend:
    image: ${IMAGE_PREFIX}-frontend:${TAG}
    ports:
      - target: 5173
        published: ${FRONTEND_PORT}
        protocol: tcp
        mode: ingress
    environment:
      VITE_API_URL: "${VITE_API_URL}"
    depends_on:
      - backend
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure

  backend:
    image: ${IMAGE_PREFIX}-backend:${TAG}
    ports:
      - target: 8000
        published: ${BACKEND_PORT}
        protocol: tcp
        mode: ingress
    environment:
      ODSAY_API_KEY: "${ODSAY_API_KEY}"
      ODSAY_REFERER: "${ODSAY_REFERER}"
      KAKAO_REST_API_KEY: "${KAKAO_REST_API_KEY}"
    volumes:
      - backend-data:/app/data
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure

volumes:
  backend-data:
EOF

docker stack deploy -c "${STACK_FILE}" "${STACK_NAME}"

echo "Deployed stack: ${STACK_NAME}"
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo "Backend:  http://localhost:${BACKEND_PORT}"
