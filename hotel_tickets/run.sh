#!/usr/bin/with-contenv bashio
# shellcheck shell=bash

export LOG_LEVEL=$(bashio::config 'log_level')
export SMTP_ENABLED=$(bashio::config 'smtp_enabled')
# Database in /config/ zodat het niet verloren gaat bij herinstallatie
mkdir -p /config/hotel_tickets
export DB_PATH="/config/hotel_tickets/hotel_tickets.db"

# Migreer van oude locatie als nieuwe nog leeg is
if [ ! -f "$DB_PATH" ] && [ -f "/data/hotel_tickets.db" ]; then
    cp /data/hotel_tickets.db "$DB_PATH"
    bashio::log.info "Database gemigreerd van /data/ naar /config/hotel_tickets/"
fi

# Optionele SMTP velden met lege string als fallback
if bashio::config.has_value 'smtp_host'; then
    export SMTP_HOST=$(bashio::config 'smtp_host')
fi
if bashio::config.has_value 'smtp_port'; then
    export SMTP_PORT=$(bashio::config 'smtp_port')
fi
if bashio::config.has_value 'smtp_user'; then
    export SMTP_USER=$(bashio::config 'smtp_user')
fi
if bashio::config.has_value 'smtp_password'; then
    export SMTP_PASSWORD=$(bashio::config 'smtp_password')
fi
if bashio::config.has_value 'smtp_from'; then
    export SMTP_FROM=$(bashio::config 'smtp_from')
fi

# Standalone toegang: toegestane netwerken (CIDR's) en sessieduur
if bashio::config.has_value 'allowed_networks'; then
    export ALLOWED_NETWORKS=$(bashio::config 'allowed_networks' | tr '\n' ',' | sed 's/,*$//')
fi
if bashio::config.has_value 'session_hours'; then
    export SESSION_HOURS=$(bashio::config 'session_hours')
fi

# Claude / AI kennisbot (optioneel)
if bashio::config.has_value 'claude_api_key'; then
    export CLAUDE_API_KEY=$(bashio::config 'claude_api_key')
fi
if bashio::config.has_value 'claude_model'; then
    export CLAUDE_MODEL=$(bashio::config 'claude_model')
fi

bashio::log.info "Starting Hotel Ticket System..."

cd /app
exec python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8080 \
    --log-level "${LOG_LEVEL}"
