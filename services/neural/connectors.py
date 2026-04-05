"""
A.L.E.C. Data Connectors — reads from local data sources on the owner's machine.

Connectors:
1. iMessage — reads from ~/Library/Messages/chat.db (macOS)
2. Gmail — reads via IMAP (requires app password)
3. Contacts — reads from macOS Contacts database
4. Notes — reads from macOS Notes database
5. Calendar — reads from macOS Calendar database

These are how A.L.E.C. learns the owner's natural language and communication patterns.
"""

import os
import json
import sqlite3
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.connectors")

SFT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "sft"


class iMessageConnector:
    """
    Reads iMessage conversations from macOS Messages database.
    Path: ~/Library/Messages/chat.db
    
    Requires Full Disk Access in System Settings > Privacy & Security.
    """

    CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"

    def __init__(self):
        self.connected = False
        self.message_count = 0
        self.last_sync: Optional[str] = None

    def check_access(self) -> dict:
        """Check if we can access the iMessage database."""
        if not self.CHAT_DB.exists():
            return {"accessible": False, "error": "Messages database not found. Is this a Mac?"}
        try:
            conn = sqlite3.connect(f"file:{self.CHAT_DB}?mode=ro", uri=True)
            count = conn.execute("SELECT COUNT(*) FROM message").fetchone()[0]
            conn.close()
            self.connected = True
            self.message_count = count
            return {"accessible": True, "message_count": count}
        except sqlite3.OperationalError as e:
            if "unable to open" in str(e) or "not authorized" in str(e):
                return {
                    "accessible": False,
                    "error": "Full Disk Access required. Go to System Settings > Privacy & Security > Full Disk Access and add Terminal/Python.",
                }
            return {"accessible": False, "error": str(e)}

    def get_recent_messages(self, limit: int = 100, days: int = 30) -> list[dict]:
        """Get recent iMessages."""
        if not self.CHAT_DB.exists():
            return []
        try:
            conn = sqlite3.connect(f"file:{self.CHAT_DB}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            
            # macOS Messages uses a special date format (seconds since 2001-01-01)
            # Convert to Unix timestamp: add 978307200
            cursor = conn.execute("""
                SELECT 
                    m.ROWID as id,
                    m.text,
                    m.is_from_me,
                    datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime') as timestamp,
                    h.id as contact_id,
                    c.display_name as chat_name
                FROM message m
                LEFT JOIN handle h ON m.handle_id = h.ROWID
                LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
                LEFT JOIN chat c ON cmj.chat_id = c.ROWID
                WHERE m.text IS NOT NULL 
                  AND m.text != ''
                  AND m.date > (strftime('%s', 'now', '-' || ? || ' days') - 978307200) * 1000000000
                ORDER BY m.date DESC
                LIMIT ?
            """, (days, limit))
            
            messages = [dict(row) for row in cursor.fetchall()]
            conn.close()
            return messages
        except Exception as e:
            logger.error(f"iMessage read failed: {e}")
            return []

    def get_conversations(self, limit: int = 20) -> list[dict]:
        """Get list of recent conversations/chats."""
        if not self.CHAT_DB.exists():
            return []
        try:
            conn = sqlite3.connect(f"file:{self.CHAT_DB}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT 
                    c.ROWID as chat_id,
                    c.display_name,
                    c.chat_identifier,
                    COUNT(cmj.message_id) as message_count,
                    MAX(datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) as last_message
                FROM chat c
                JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
                JOIN message m ON cmj.message_id = m.ROWID
                GROUP BY c.ROWID
                ORDER BY MAX(m.date) DESC
                LIMIT ?
            """, (limit,))
            convos = [dict(row) for row in cursor.fetchall()]
            conn.close()
            return convos
        except Exception as e:
            logger.error(f"iMessage conversations failed: {e}")
            return []

    def generate_training_data(self, days: int = 90) -> int:
        """
        Generate training data from iMessage conversations.
        Creates conversational pairs that teach A.L.E.C. the owner's communication style.
        """
        messages = self.get_recent_messages(limit=10000, days=days)
        if not messages:
            return 0

        SFT_DIR.mkdir(parents=True, exist_ok=True)
        output = SFT_DIR / "imessage_style.jsonl"
        examples = []

        # Group by conversation and create pairs
        # Messages from owner (is_from_me=1) are "assistant" responses
        # Messages to owner (is_from_me=0) are "user" prompts
        i = 0
        while i < len(messages) - 1:
            msg = messages[i]
            next_msg = messages[i + 1]
            
            # Pattern: someone messages Alec → Alec responds
            if msg.get("is_from_me") == 0 and next_msg.get("is_from_me") == 1:
                if msg.get("text") and next_msg.get("text"):
                    # Only include substantial messages (not just "ok" or "lol")
                    if len(msg["text"]) > 10 and len(next_msg["text"]) > 10:
                        examples.append({
                            "messages": [
                                {"role": "system", "content": "You are A.L.E.C. Respond in Alec Rovner's natural communication style."},
                                {"role": "user", "content": msg["text"][:500]},
                                {"role": "assistant", "content": next_msg["text"][:500]},
                            ]
                        })
                i += 2
            else:
                i += 1

        with open(output, "w") as f:
            for ex in examples:
                f.write(json.dumps(ex) + "\n")

        self.last_sync = datetime.now(timezone.utc).isoformat()
        logger.info(f"Generated {len(examples)} iMessage training examples")
        return len(examples)

    def get_status(self) -> dict:
        access = self.check_access()
        return {
            "type": "imessage",
            "connected": self.connected,
            "message_count": self.message_count,
            "last_sync": self.last_sync,
            "db_path": str(self.CHAT_DB),
            **access,
        }


class GmailConnector:
    """
    Reads Gmail via IMAP. Requires an app password.
    Go to: Google Account > Security > 2-Step Verification > App Passwords
    """

    def __init__(self):
        self.email = os.getenv("GMAIL_EMAIL", "")
        self.app_password = os.getenv("GMAIL_APP_PASSWORD", "")
        self.connected = False
        self.last_sync: Optional[str] = None

    def check_access(self) -> dict:
        if not self.email or not self.app_password:
            return {
                "accessible": False,
                "error": "Set GMAIL_EMAIL and GMAIL_APP_PASSWORD in .env. Get an app password from Google Account > Security > App Passwords.",
            }
        try:
            import imaplib
            mail = imaplib.IMAP4_SSL("imap.gmail.com")
            mail.login(self.email, self.app_password)
            mail.logout()
            self.connected = True
            return {"accessible": True}
        except Exception as e:
            return {"accessible": False, "error": str(e)}

    def get_recent_emails(self, folder: str = "INBOX", limit: int = 50) -> list[dict]:
        """Fetch recent emails."""
        if not self.email or not self.app_password:
            return []
        try:
            import imaplib
            import email
            from email.header import decode_header

            mail = imaplib.IMAP4_SSL("imap.gmail.com")
            mail.login(self.email, self.app_password)
            mail.select(folder)

            _, msg_ids = mail.search(None, "ALL")
            ids = msg_ids[0].split()[-limit:]  # Last N emails

            emails = []
            for eid in reversed(ids):
                _, data = mail.fetch(eid, "(RFC822)")
                msg = email.message_from_bytes(data[0][1])
                
                subject = ""
                raw_subject = msg["Subject"]
                if raw_subject:
                    decoded = decode_header(raw_subject)
                    subject = decoded[0][0]
                    if isinstance(subject, bytes):
                        subject = subject.decode(decoded[0][1] or "utf-8", errors="ignore")

                body = ""
                if msg.is_multipart():
                    for part in msg.walk():
                        if part.get_content_type() == "text/plain":
                            body = part.get_payload(decode=True).decode(errors="ignore")
                            break
                else:
                    body = msg.get_payload(decode=True).decode(errors="ignore")

                emails.append({
                    "from": msg["From"],
                    "to": msg["To"],
                    "subject": subject,
                    "date": msg["Date"],
                    "body": body[:1000],  # Truncate
                    "is_from_me": self.email.lower() in (msg["From"] or "").lower(),
                })

            mail.logout()
            return emails
        except Exception as e:
            logger.error(f"Gmail read failed: {e}")
            return []

    def generate_training_data(self) -> int:
        """Generate training data from email conversations."""
        emails = self.get_recent_emails(limit=200)
        if not emails:
            return 0

        SFT_DIR.mkdir(parents=True, exist_ok=True)
        output = SFT_DIR / "gmail_style.jsonl"
        examples = []

        for em in emails:
            if em.get("is_from_me") and em.get("body") and len(em["body"]) > 50:
                examples.append({
                    "messages": [
                        {"role": "system", "content": "You are A.L.E.C. Write emails in Alec Rovner's professional style."},
                        {"role": "user", "content": f"Write an email about: {em.get('subject', 'No subject')}"},
                        {"role": "assistant", "content": em["body"][:500]},
                    ]
                })

        with open(output, "w") as f:
            for ex in examples:
                f.write(json.dumps(ex) + "\n")

        self.last_sync = datetime.now(timezone.utc).isoformat()
        logger.info(f"Generated {len(examples)} Gmail training examples")
        return len(examples)

    def get_status(self) -> dict:
        return {
            "type": "gmail",
            "connected": self.connected,
            "email": self.email[:3] + "***" if self.email else None,
            "last_sync": self.last_sync,
            "credentials_configured": bool(self.email and self.app_password),
        }


class ConnectorManager:
    """Manages all data connectors."""

    def __init__(self):
        self.imessage = iMessageConnector()
        self.gmail = GmailConnector()

    def get_all_status(self) -> dict:
        return {
            "imessage": self.imessage.get_status(),
            "gmail": self.gmail.get_status(),
        }

    def sync_all(self) -> dict:
        results = {}
        try:
            results["imessage"] = self.imessage.generate_training_data()
        except Exception as e:
            results["imessage_error"] = str(e)
        try:
            results["gmail"] = self.gmail.generate_training_data()
        except Exception as e:
            results["gmail_error"] = str(e)
        return results
