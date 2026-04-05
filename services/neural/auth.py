"""
A.L.E.C. Authentication — bcrypt password hashing, admin user management.
"""

import os
import logging
import hashlib
import hmac
import base64
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("alec.auth")

# We use hashlib-based bcrypt-like hashing to avoid native dependency issues.
# For production, swap to proper bcrypt if available.
try:
    import bcrypt
    HAS_BCRYPT = True
except ImportError:
    HAS_BCRYPT = False
    logger.info("bcrypt not installed — using PBKDF2 fallback")


def hash_password(password: str) -> str:
    """Hash a password for storage."""
    if HAS_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()
    # PBKDF2 fallback
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
    return f"pbkdf2:{base64.b64encode(salt).decode()}:{base64.b64encode(key).decode()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against its hash."""
    if HAS_BCRYPT and stored_hash.startswith("$2"):
        return bcrypt.checkpw(password.encode(), stored_hash.encode())
    if stored_hash.startswith("pbkdf2:"):
        parts = stored_hash.split(":")
        if len(parts) != 3:
            return False
        salt = base64.b64decode(parts[1])
        stored_key = base64.b64decode(parts[2])
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
        return hmac.compare_digest(key, stored_key)
    return False


class AuthManager:
    """Manages admin users in the database."""

    def __init__(self, db):
        self.db = db

    def seed_admin(self, email: str, password: str):
        """Create the default admin user if it doesn't exist."""
        existing = self._get_user_by_email(email)
        if existing:
            logger.info(f"Admin user already exists: {email}")
            return
        pw_hash = hash_password(password)
        conn = self.db._sqlite_conn
        if conn:
            conn.execute(
                "INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)",
                (email, pw_hash, "admin"),
            )
            conn.commit()
            logger.info(f"Seeded admin user: {email}")

    def authenticate(self, email: str, password: str) -> Optional[dict]:
        """Authenticate a user. Returns user dict or None."""
        user = self._get_user_by_email(email)
        if not user:
            return None
        if not verify_password(password, user["password_hash"]):
            return None
        # Update last_login
        conn = self.db._sqlite_conn
        if conn:
            conn.execute(
                "UPDATE admin_users SET last_login = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), user["id"]),
            )
            conn.commit()
        return {
            "id": user["id"],
            "email": user["email"],
            "role": user["role"],
        }

    def create_user(self, email: str, password: str, role: str = "viewer") -> Optional[dict]:
        """Create a new user account. Only the owner can do this."""
        existing = self._get_user_by_email(email)
        if existing:
            return {"error": f"User {email} already exists"}
        pw_hash = hash_password(password)
        conn = self.db._sqlite_conn
        if conn:
            conn.execute(
                "INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)",
                (email, pw_hash, role),
            )
            conn.commit()
            logger.info(f"Created user: {email} (role: {role})")
            return {"success": True, "email": email, "role": role}
        return {"error": "Database not available"}

    def update_user_role(self, email: str, new_role: str) -> Optional[dict]:
        """Change a user's role."""
        user = self._get_user_by_email(email)
        if not user:
            return {"error": f"User {email} not found"}
        conn = self.db._sqlite_conn
        if conn:
            conn.execute("UPDATE admin_users SET role = ? WHERE email = ?", (new_role, email))
            conn.commit()
            logger.info(f"Updated role for {email}: {new_role}")
            return {"success": True, "email": email, "role": new_role}
        return {"error": "Database not available"}

    def delete_user(self, email: str) -> dict:
        """Delete a user. Cannot delete the owner."""
        owner_email = os.getenv("ADMIN_EMAIL", "arovner@campusrentalsllc.com").lower()
        if email.lower() == owner_email:
            return {"error": "Cannot delete the owner account"}
        conn = self.db._sqlite_conn
        if conn:
            conn.execute("DELETE FROM admin_users WHERE email = ?", (email,))
            conn.commit()
            logger.info(f"Deleted user: {email}")
            return {"success": True}
        return {"error": "Database not available"}

    def list_users(self) -> list[dict]:
        """List all users (passwords excluded)."""
        conn = self.db._sqlite_conn
        if not conn:
            return []
        cursor = conn.execute("SELECT id, email, role, created_at, last_login FROM admin_users ORDER BY created_at")
        return [dict(row) for row in cursor.fetchall()]

    def change_password(self, email: str, new_password: str) -> dict:
        """Change a user's password."""
        user = self._get_user_by_email(email)
        if not user:
            return {"error": f"User {email} not found"}
        pw_hash = hash_password(new_password)
        conn = self.db._sqlite_conn
        if conn:
            conn.execute("UPDATE admin_users SET password_hash = ? WHERE email = ?", (pw_hash, email))
            conn.commit()
            return {"success": True}
        return {"error": "Database not available"}

    def _get_user_by_email(self, email: str) -> Optional[dict]:
        conn = self.db._sqlite_conn
        if not conn:
            return None
        cursor = conn.execute(
            "SELECT * FROM admin_users WHERE email = ?", (email,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def is_owner(self, email: str) -> bool:
        """Check if this email is the owner/creator of A.L.E.C."""
        owner_email = os.getenv("ADMIN_EMAIL", "arovner@campusrentalsllc.com").lower()
        return email.lower() == owner_email

    def determine_access_level(self, email: str, is_domo_embed: bool = False) -> str:
        """
        Access hierarchy:
        - OWNER (arovner@campusrentalsllc.com only) → Everything. God mode.
        - ADMIN (role='admin') → Full access except owner-level settings
        - FULL_ACCESS (role='full_access') → Chat + all data + files + training
        - STOA (role='stoa' or Domo embed) → Chat + Stoa data read-only
        - VIEWER (default) → Chat only
        """
        if is_domo_embed:
            return "STOA_ACCESS"
        if self.is_owner(email):
            return "OWNER"
        user = self._get_user_by_email(email)
        if user:
            role = user.get("role", "viewer")
            if role == "admin":
                return "FULL_CAPABILITIES"
            if role == "full_access":
                return "FULL_CAPABILITIES"
            if role == "stoa":
                return "STOA_ACCESS"
        return "STOA_ACCESS"
