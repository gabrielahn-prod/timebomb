#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE_PREFIX="${IMAGE_PREFIX:-timebomb}"
TAG="${TAG:-latest}"
PUSH="${PUSH:-0}"

docker build -t "${IMAGE_PREFIX}-frontend:${TAG}" "${ROOT_DIR}"
docker build -t "${IMAGE_PREFIX}-backend:${TAG}" "${ROOT_DIR}/backend"

if [[ "${PUSH}" == "1" ]]; then
  docker push "${IMAGE_PREFIX}-frontend:${TAG}"
  docker push "${IMAGE_PREFIX}-backend:${TAG}"
fi

"${ROOT_DIR}/deploy.sh"
