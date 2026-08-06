#!/usr/bin/env bash
#
# Genereert de beta-addon (hotel_tickets_beta/) uit de productie-addon
# (hotel_tickets/) plus de overlay in scripts/beta-overlay/.
#
# De beta draait exact dezelfde code als productie — het verschil zit alleen in
# config.yaml (eigen slug, poorten, paneel) en run.sh (eigen database, geen
# meldingen). Daarom is hotel_tickets_beta/ volledig gegenereerd: bewerk nooit
# iets in die map, maar in hotel_tickets/ of scripts/beta-overlay/.
#
# Gebruik:
#   scripts/sync-beta.sh          synchroniseren
#   scripts/sync-beta.sh --check  alleen controleren of het in sync is (CI)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/hotel_tickets"
OVERLAY="$ROOT/scripts/beta-overlay"
DEST="$ROOT/hotel_tickets_beta"

CHECK=false
if [[ "${1:-}" == "--check" ]]; then
    CHECK=true
    REAL_DEST="$DEST"
    DEST="$(mktemp -d)/hotel_tickets_beta"
fi

build() {
    local dest="$1"
    rm -rf "$dest"
    mkdir -p "$dest"

    # Alle broncode kopiëren, zonder build-uitvoer, caches en databases.
    (
        cd "$SRC"
        find . \
            \( -name node_modules -o -name .venv -o -name __pycache__ \
               -o -name dist -o -name .vite \) -prune -o \
            -type f \
            ! -name '*.pyc' ! -name '*.db' ! -name '*.db-shm' ! -name '*.db-wal' \
            ! -name '*.tsbuildinfo' ! -name '.DS_Store' \
            -print
    ) | while IFS= read -r file; do
        mkdir -p "$dest/$(dirname "$file")"
        cp -p "$SRC/$file" "$dest/$file"
    done

    # Overlay: beta-specifieke bestanden overschrijven de gekopieerde versie.
    cp "$OVERLAY/config.yaml" "$dest/config.yaml"
    cp "$OVERLAY/run.sh" "$dest/run.sh"
    chmod +x "$dest/run.sh"

    # Versie gelijktrekken met productie, zodat HA een beta-update aanbiedt
    # zodra productie een nieuwe versie krijgt.
    local version
    version="$(sed -n 's/^version:[[:space:]]*"\{0,1\}\([^"[:space:]]*\)"\{0,1\}.*/\1/p' "$SRC/config.yaml" | head -1)"
    if [[ -z "$version" ]]; then
        echo "Kon de versie niet uit $SRC/config.yaml lezen" >&2
        exit 1
    fi
    sed "s/^version:.*/version: \"$version\"/" "$dest/config.yaml" > "$dest/config.yaml.tmp"
    mv "$dest/config.yaml.tmp" "$dest/config.yaml"

    cat > "$dest/GEGENEREERD.md" <<'EOF'
# Niet handmatig bewerken

Deze map is gegenereerd door `scripts/sync-beta.sh` uit `hotel_tickets/` plus
de overlay in `scripts/beta-overlay/`. Wijzigingen hier worden bij de volgende
sync overschreven.

* Functionaliteit aanpassen → `hotel_tickets/`
* Beta-specifieke instellingen (slug, poorten, database, BETA_MODE) →
  `scripts/beta-overlay/`

`frontend/dist/` staat hier bewust niet in: de Dockerfile bouwt de frontend
tijdens het bouwen van de addon.
EOF

    echo "$version"
}

VERSION="$(build "$DEST")"

if $CHECK; then
    if diff -r -q "$DEST" "$REAL_DEST" > /dev/null 2>&1; then
        echo "hotel_tickets_beta/ is in sync (versie $VERSION)"
    else
        echo "hotel_tickets_beta/ loopt achter — draai scripts/sync-beta.sh" >&2
        diff -r -q "$DEST" "$REAL_DEST" >&2 || true
        exit 1
    fi
else
    echo "hotel_tickets_beta/ bijgewerkt (versie $VERSION)"
fi
