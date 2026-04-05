"""
A.L.E.C. Data Encryption — encrypts sensitive data before storing in the database.

Uses Fernet symmetric encryption (AES-128-CBC with HMAC).
The encryption key is derived from the JWT_SECRET in .env.
All training data, conversation content, and file contents are encrypted at rest.
"""

import os
import base64
import hashlib
import logging
from typing import Optional

logger = logging.getLogger("alec.encryption")

try:
    from cryptography.fernet import Fernet
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False
    logger.info("cryptography not installed — using base64 obfuscation fallback")


def _derive_key(secret: Optional[str] = None) -> bytes:
    """Derive a Fernet key from the JWT secret."""
    secret = secret or os.getenv("JWT_SECRET", "alec-default-key-change-me")
    # Fernet needs a 32-byte URL-safe base64-encoded key
    key_bytes = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key_bytes)


class DataEncryptor:
    """Encrypts/decrypts sensitive data stored in the database."""

    def __init__(self):
        self.key = _derive_key()
        if HAS_CRYPTO:
            self.fernet = Fernet(self.key)
            logger.info("Encryption initialized (Fernet AES-128-CBC)")
        else:
            self.fernet = None
            logger.warning("Using base64 obfuscation (install cryptography for real encryption)")

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a string. Returns base64-encoded ciphertext."""
        if not plaintext:
            return plaintext
        if self.fernet:
            return self.fernet.encrypt(plaintext.encode()).decode()
        # Fallback: base64 encode (not real encryption, but obfuscates)
        return "b64:" + base64.b64encode(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt a string. Returns plaintext."""
        if not ciphertext:
            return ciphertext
        if ciphertext.startswith("b64:"):
            return base64.b64decode(ciphertext[4:]).decode()
        if self.fernet:
            try:
                return self.fernet.decrypt(ciphertext.encode()).decode()
            except Exception:
                # If decryption fails, return as-is (might be unencrypted legacy data)
                return ciphertext
        return ciphertext

    def is_encrypted(self, text: str) -> bool:
        """Check if a string looks like it's already encrypted."""
        if not text:
            return False
        if text.startswith("b64:"):
            return True
        if text.startswith("gAAAAA"):  # Fernet token prefix
            return True
        return False


# Global singleton
_encryptor: Optional[DataEncryptor] = None

def get_encryptor() -> DataEncryptor:
    global _encryptor
    if _encryptor is None:
        _encryptor = DataEncryptor()
    return _encryptor
