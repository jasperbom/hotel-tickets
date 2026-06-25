ARG BUILD_FROM
FROM $BUILD_FROM

# Python 3.13 komt uit de base-python image (zie build.yaml). We installeren
# alleen Node.js (frontend build) + een C-toolchain als vangnet voor eventuele
# packages zonder kant-en-klare wheel.
RUN apk add --no-cache \
    nodejs \
    npm \
    gcc \
    musl-dev \
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

# Copy startup script
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
