"""
Sessietokens voor de standalone loginpagina.

HMAC-SHA256-ondertekende tokens zonder extra dependencies. Payload is JSON
{"uid": <ha_user_id>, "exp": <unix timestamp>}, base64url-gecodeerd. Het
geheim wordt naast de database bewaard (/config/hotel_tickets/) zodat
sessies een addon-herstart of update overleven.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time

logger = logging.getLogger(__name__)

SESSION_HOURS = int(os.environ.get("SESSION_HOURS", "12"))

# Prefix onderscheidt onze tokens van HA Supervisor-tokens in de auth-flow
TOKEN_PREFIX = "hts."

_secret: bytes | None = None


def _secret_path() -> str:
    db_dir = os.path.dirname(os.path.abspath(os.environ.get("DB_PATH", "./hotel_tickets.db")))
    return os.path.join(db_dir, "session_secret")


def _get_secret() -> bytes:
    global _secret
    if _secret is not None:
        return _secret
    path = _secret_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        if len(value) >= 32:
            _secret = value.encode()
            return _secret
        logger.warning("Sessiegeheim in %s is te kort — nieuw geheim genereren", path)
    except FileNotFoundError:
        pass
    value = secrets.token_hex(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(value)
    logger.info("Nieuw sessiegeheim aangemaakt in %s", path)
    _secret = value.encode()
    return _secret


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_session_token(ha_user_id: str) -> tuple[str, int]:
    """Maak een sessietoken; geeft (token, expiry-unix-timestamp) terug."""
    expires_at = int(time.time()) + SESSION_HOURS * 3600
    payload = json.dumps({"uid": ha_user_id, "exp": expires_at}, separators=(",", ":"))
    body = _b64encode(payload.encode())
    signature = hmac.new(_get_secret(), body.encode(), hashlib.sha256).digest()
    return f"{TOKEN_PREFIX}{body}.{_b64encode(signature)}", expires_at


def verify_session_token(token: str) -> str | None:
    """Geeft de ha_user_id terug bij een geldig, niet-verlopen token, anders None."""
    if not token.startswith(TOKEN_PREFIX):
        return None
    try:
        body, signature = token[len(TOKEN_PREFIX):].split(".", 1)
        expected = hmac.new(_get_secret(), body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature)):
            return None
        payload = json.loads(_b64decode(body))
        if payload.get("exp", 0) < time.time():
            return None
        uid = payload.get("uid")
        return uid if isinstance(uid, str) and uid else None
    except Exception:
        return None
