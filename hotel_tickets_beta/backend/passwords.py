"""
Wachtwoord-hashing voor lokale app-accounts.

Lokale accounts worden door een admin aangemaakt in de app zelf en hebben
géén Home Assistant-account nodig: het wachtwoord staat als PBKDF2-hash in
`user_roles.password_hash`. Gebruikt uitsluitend de standaardbibliotheek —
geen extra dependencies.

Opslagformaat: pbkdf2$<iteraties>$<salt-hex>$<hash-hex>
"""
import hashlib
import hmac
import secrets

# OWASP-aanbeveling voor PBKDF2-HMAC-SHA256
ITERATIONS = 600_000

# HA dwingt zelf nauwelijks een wachtwoordbeleid af; hanteer een minimum.
# Geldt zowel voor lokale accounts als voor HA-wachtwoordwijzigingen.
MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS)
    return f"pbkdf2${ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt, expected = stored.split("$", 3)
        if scheme != "pbkdf2":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), expected)
    except Exception:
        return False
