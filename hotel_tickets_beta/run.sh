#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
#
# Startscript van de BETA-addon. Identiek aan dat van productie, met drie
# verschillen: een eigen datamap, BETA_MODE=true (geen meldingen, geen HA-
# sensoren) en de verwijzing naar de productiedata die gekopieerd kan worden.
# Dit bestand komt uit scripts/beta-overlay/ — bewerk het daar, niet in
# hotel_tickets_beta/ (dat wordt overschreven door scripts/sync-beta.sh).

export LOG_LEVEL=$(bashio::config 'log_level')
export SMTP_ENABLED=$(bashio::config 'smtp_enabled')

# ── Beta-omgeving ─────────────────────────────────────────────────────────────
export BETA_MODE="true"
export BETA_LABEL="BETA"
export BETA_BASE_URL="/hassio/ingress/hotel_tickets_beta"
# Data van de productie-addon (alleen lezen; te kopiëren via Instellingen → Beta)
export SOURCE_DB_PATH="/config/hotel_tickets/hotel_tickets.db"
export SOURCE_UPLOAD_DIR="/config/hotel_tickets/uploads"

# Eigen database + uploadmap, volledig gescheiden van productie
mkdir -p /config/hotel_tickets_beta
export DB_PATH="/config/hotel_tickets_beta/hotel_tickets.db"
export UPLOAD_DIR="/config/hotel_tickets_beta/uploads"
mkdir -p "$UPLOAD_DIR"

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

# ── HTTPS (standalone toegang) ────────────────────────────────────────────────
# Zie de toelichting in de productie-run.sh; de beta luistert op 8444 zodat hij
# niet botst met productie op 8443.
PROXY_ARGS=""
if bashio::config.true 'ssl'; then
    CERTFILE="/ssl/$(bashio::config 'certfile')"
    KEYFILE="/ssl/$(bashio::config 'keyfile')"
    if [ -f "$CERTFILE" ] && [ -f "$KEYFILE" ]; then
        mkdir -p /etc/nginx/http.d /run/nginx
        rm -f /etc/nginx/http.d/default.conf
        cat > /etc/nginx/http.d/hotel_tickets_beta.conf <<EOF
server {
    listen 8444 ssl;
    listen [::]:8444 ssl;
    ssl_certificate ${CERTFILE};
    ssl_certificate_key ${KEYFILE};
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        # Ingress-identiteitsheaders nooit van buitenaf doorlaten
        proxy_set_header X-Remote-User-ID "";
        proxy_set_header X-Remote-User-Name "";
        proxy_set_header X-Remote-User-Display-Name "";
    }
}
EOF
        if nginx -t; then
            nginx
            PROXY_ARGS="--proxy-headers --forwarded-allow-ips 127.0.0.1"
            bashio::log.info "HTTPS actief op poort 8444 (certificaat: ${CERTFILE})"
        else
            bashio::log.warning "nginx-configuratie ongeldig — HTTPS niet gestart"
        fi
    else
        bashio::log.warning "SSL staat aan maar ${CERTFILE} of ${KEYFILE} ontbreekt — HTTPS niet gestart"
    fi
fi

bashio::log.info "Starting Hotel Ticket System (BETA)..."
bashio::log.info "Database: ${DB_PATH} — productiedata om te kopiëren: ${SOURCE_DB_PATH}"

cd /app
# shellcheck disable=SC2086
exec python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8080 \
    --log-level "${LOG_LEVEL}" \
    ${PROXY_ARGS}
