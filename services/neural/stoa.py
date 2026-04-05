"""
A.L.E.C. Stoa Database Connector — connects to the Stoa Group Azure SQL database,
pulls real estate data, and generates training examples for continuous learning.

This is what makes A.L.E.C. a domain expert in real estate finance.
"""

import os
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.stoa")

SFT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "sft"


class StoaConnector:
    """Connects to the Stoa Group Azure SQL database for continuous learning."""

    def __init__(self):
        self.host = os.getenv("STOA_DB_HOST", "stoagroupdb.database.windows.net")
        self.port = int(os.getenv("STOA_DB_PORT", "1433"))
        self.database = os.getenv("STOA_DB_NAME", "stoagroupDB")
        self.user = os.getenv("STOA_DB_USER", "")
        self.password = os.getenv("STOA_DB_PASSWORD", "")
        self.ssl = os.getenv("STOA_DB_SSL", "true").lower() == "true"
        self._conn = None
        self.connected = False
        self.last_sync: Optional[str] = None
        self.tables_discovered: list[str] = []

    def _get_connection(self):
        """Get a database connection using pyodbc or pymssql fallback."""
        # Try pymssql first (no unixodbc dependency)
        try:
            import pymssql
            conn = pymssql.connect(
                server=self.host,
                port=self.port,
                user=self.user,
                password=self.password,
                database=self.database,
                login_timeout=15,
                tds_version="7.3",
            )
            return conn
        except ImportError:
            pass
        except Exception as e:
            logger.debug(f"pymssql failed: {e}")

        # Fallback to pyodbc
        try:
            import pyodbc
            driver = "{ODBC Driver 18 for SQL Server}"
            encrypt = "yes" if self.ssl else "no"
            conn_str = (
                f"DRIVER={driver};"
                f"SERVER=tcp:{self.host},{self.port};"
                f"DATABASE={self.database};"
                f"UID={self.user};"
                f"PWD={self.password};"
                f"Encrypt={encrypt};"
                f"TrustServerCertificate=yes;"
                f"Connection Timeout=30;"
            )
            return pyodbc.connect(conn_str, timeout=15)
        except Exception as e:
            raise ConnectionError(f"No SQL driver available: {e}")

    def connect(self) -> bool:
        """Test connection to Stoa database."""
        if not self.user or not self.password:
            logger.warning("Stoa DB credentials not configured")
            return False
        try:
            conn = self._get_connection()
            conn.close()
            self.connected = True
            logger.info(f"Stoa DB connected: {self.host}/{self.database}")
            return True
        except Exception as e:
            logger.warning(f"Stoa DB connection failed: {e}")
            self.connected = False
            return False

    def discover_tables(self) -> list[str]:
        """Discover all tables in the Stoa database."""
        try:
            import pyodbc
            conn = pyodbc.connect(self._get_conn_string(), timeout=30)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT TABLE_SCHEMA + '.' + TABLE_NAME as full_name
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            """)
            self.tables_discovered = [row[0] for row in cursor.fetchall()]
            conn.close()
            logger.info(f"Discovered {len(self.tables_discovered)} tables in Stoa DB")
            return self.tables_discovered
        except Exception as e:
            logger.error(f"Table discovery failed: {e}")
            return []

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a query against Stoa DB and return results as dicts."""
        try:
            import pyodbc
            conn = pyodbc.connect(self._get_conn_string(), timeout=30)
            cursor = conn.cursor()
            cursor.execute(sql, params)
            cols = [d[0] for d in cursor.description] if cursor.description else []
            rows = [dict(zip(cols, row)) for row in cursor.fetchall()]
            conn.close()
            return rows
        except Exception as e:
            logger.error(f"Stoa query failed: {e}")
            return []

    def get_table_sample(self, table_name: str, limit: int = 5) -> list[dict]:
        """Get a sample of rows from a table."""
        # Sanitize table name to prevent injection
        if not all(c.isalnum() or c in "._[]" for c in table_name):
            return []
        return self.query(f"SELECT TOP {limit} * FROM {table_name}")

    def get_table_schema(self, table_name: str) -> list[dict]:
        """Get column info for a table."""
        parts = table_name.split(".")
        schema = parts[0] if len(parts) > 1 else "dbo"
        tbl = parts[-1]
        return self.query("""
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
        """, (schema, tbl))

    def generate_training_data(self) -> int:
        """
        Pull data from Stoa DB and generate training examples.
        Creates Q&A pairs that teach A.L.E.C. about the real estate portfolio.
        """
        SFT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = SFT_DIR / "stoa_training.jsonl"
        examples = []

        tables = self.discover_tables()
        if not tables:
            logger.warning("No tables found — skipping training data generation")
            return 0

        # Generate schema-awareness examples
        for table in tables[:30]:  # Limit to avoid overwhelming
            schema = self.get_table_schema(table)
            if schema:
                cols = ", ".join([f"{c['COLUMN_NAME']} ({c['DATA_TYPE']})" for c in schema])
                examples.append({
                    "messages": [
                        {"role": "system", "content": "You are A.L.E.C., an AI expert in Stoa Group's real estate data."},
                        {"role": "user", "content": f"What columns are in the {table} table?"},
                        {"role": "assistant", "content": f"The {table} table has the following columns: {cols}"},
                    ]
                })

            # Get sample data for richer examples
            sample = self.get_table_sample(table, limit=3)
            if sample:
                for row in sample:
                    # Create a natural-language description of the row
                    desc_parts = []
                    for k, v in row.items():
                        if v is not None and str(v).strip():
                            desc_parts.append(f"{k}: {v}")
                    if desc_parts:
                        desc = "; ".join(desc_parts[:8])  # Limit fields
                        examples.append({
                            "messages": [
                                {"role": "system", "content": "You are A.L.E.C., an AI expert in Stoa Group's real estate data."},
                                {"role": "user", "content": f"Show me a record from {table}."},
                                {"role": "assistant", "content": f"Here's a record from {table}: {desc}"},
                            ]
                        })

        # Write JSONL
        with open(output_path, "w") as f:
            for ex in examples:
                f.write(json.dumps(ex) + "\n")

        self.last_sync = datetime.now(timezone.utc).isoformat()
        logger.info(f"Generated {len(examples)} Stoa training examples → {output_path}")
        return len(examples)

    def sync_and_generate_training_data(self) -> int:
        """Full sync: connect, discover, generate."""
        if not self.connect():
            return 0
        return self.generate_training_data()

    def get_status(self) -> dict:
        """Return current Stoa connector status."""
        return {
            "connected": self.connected,
            "host": self.host,
            "database": self.database,
            "tables_discovered": len(self.tables_discovered),
            "last_sync": self.last_sync,
            "credentials_configured": bool(self.user and self.password),
        }
