#!/bin/bash
set -e

# HA schrijft addon opties naar /data/options.json
# jq is beschikbaar in alle HA base images
LOG_LEVEL=$(jq --raw-output '.log_level // "info"' /data/options.json)
SMTP_ENABLED=$(jq --raw-output '.smtp_enabled // false' /data/options.json)
SMTP_HOST=$(jq --raw-output '.smtp_host // ""' /data/options.json)
SMTP_PORT=$(jq --raw-output '.smtp_port // 587' /data/options.json)
SMTP_USER=$(jq --raw-output '.smtp_user // ""' /data/options.json)
SMTP_PASSWORD=$(jq --raw-output '.smtp_password // ""' /data/options.json)
SMTP_FROM=$(jq --raw-output '.smtp_from // ""' /data/options.json)

export LOG_LEVEL SMTP_ENABLED SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM
export DB_PATH="/data/hotel_tickets.db"

echo "[hotel_tickets] Starting on port 8080..."

cd /app
exec python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8080 \
    --log-level "${LOG_LEVEL}"
