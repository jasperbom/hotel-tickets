#!/usr/bin/with-contenv bashio

export LOG_LEVEL=$(bashio::config 'log_level')
export SMTP_HOST=$(bashio::config 'smtp_host')
export SMTP_PORT=$(bashio::config 'smtp_port')
export SMTP_USER=$(bashio::config 'smtp_user')
export SMTP_PASSWORD=$(bashio::config 'smtp_password')
export SMTP_FROM=$(bashio::config 'smtp_from')
export SMTP_ENABLED=$(bashio::config 'smtp_enabled')

# HA Supervisor token is available via this env var
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"

# Data directory (mapped as /data in the addon)
export DB_PATH="/data/hotel_tickets.db"

bashio::log.info "Starting Hotel Ticket System..."

cd /app
exec python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8080 \
    --log-level "${LOG_LEVEL}"
