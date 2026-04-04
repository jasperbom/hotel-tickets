ARG BUILD_FROM
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
COPY backend/requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --prefer-offline

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Copy backend
COPY backend/ ./backend/

# Bundel de HA integratie-bestanden zodat de addon ze kan installeren
COPY integration/ ./integration/

# Copy rootfs (bevat s6-overlay service definitie)
COPY rootfs /
RUN chmod a+x /etc/services.d/hotel_tickets/run
