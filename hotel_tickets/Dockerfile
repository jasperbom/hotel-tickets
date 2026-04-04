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

# Register als s6-overlay v3 longrun service
RUN mkdir -p /etc/s6-overlay/s6-rc.d/hotel_tickets \
    && mkdir -p /etc/s6-overlay/user/contents.d

COPY run.sh /etc/s6-overlay/s6-rc.d/hotel_tickets/run
RUN chmod a+x /etc/s6-overlay/s6-rc.d/hotel_tickets/run \
    && echo "longrun" > /etc/s6-overlay/s6-rc.d/hotel_tickets/type \
    && touch /etc/s6-overlay/user/contents.d/hotel_tickets
