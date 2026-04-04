ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# Install Python and Node.js build deps
RUN apk add --no-cache \
    python3 \
    py3-pip \
    nodejs \
    npm \
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev

WORKDIR /app

# Install Python dependencies
# --break-system-packages is required on Alpine Linux (PEP 668)
COPY backend/requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --prefer-offline

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Copy backend
COPY backend/ ./backend/

# Register as s6 service (HA base image uses s6-overlay as PID 1)
RUN mkdir -p /etc/services.d/hotel_tickets
COPY run.sh /etc/services.d/hotel_tickets/run
RUN chmod a+x /etc/services.d/hotel_tickets/run
