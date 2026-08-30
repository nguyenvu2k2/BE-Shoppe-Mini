#!/usr/bin/env bash
# Chạy trên VPS, trong thư mục chứa docker-compose.prod.yml và .env
# Usage:
#   IMAGE_NAME=ghcr.io/<user>/shoppe-api IMAGE_TAG=<sha> ./scripts/vps-deploy.sh
set -euo pipefail

: "${IMAGE_NAME:?IMAGE_NAME is required (e.g. ghcr.io/you/shoppe-api)}"
: "${IMAGE_TAG:?IMAGE_TAG is required (commit sha or latest)}"

export IMAGE_NAME IMAGE_TAG

echo "==> Pull api ${IMAGE_NAME}:${IMAGE_TAG}"
docker compose -f docker-compose.prod.yml pull api

echo "==> prisma migrate deploy"
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy

echo "==> Up stack"
docker compose -f docker-compose.prod.yml up -d

echo "==> Done. API should be on port \${API_PORT:-3001}"
