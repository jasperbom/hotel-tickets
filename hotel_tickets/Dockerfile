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
RUN pip3 install --no-cache-dir -r requirements.txt

# Build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Copy backend
COPY backend/ ./backend/

# Copy run script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
