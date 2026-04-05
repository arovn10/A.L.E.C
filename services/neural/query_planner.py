"""
A.L.E.C. Query Planner — SELF-DISCOVERING.

Does NOT use hardcoded table names. Instead:
1. On startup, discovers all tables and their columns from the Stoa DB
2. When a user asks a question, matches keywords to real column/table names
3. Generates SQL dynamically based on what it finds
4. Learns which queries work and caches them for next time
5. If a query fails, tries alternatives automatically

A.L.E.C. should be able to do what a human DBA does — explore, query, learn.
"""

import json
import logging
import re
from typing import Optional
from pathlib import Path

logger = logging.getLogger("alec.query_planner")

CACHE_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "query_cache.json"


class QueryPlanner:
    """Self-discovering query planner. Learns the schema, writes its own SQL."""

    def __init__(self, stoa):
        self.stoa = stoa
        self.query_count = 0
        self.successful_queries = 0
        self.schema: dict[str, list[str]] = {}  # table -> [columns]
        self.query_cache: dict[str, str] = {}  # keyword -> SQL that worked
        self._load_cache()

    def _load_cache(self):
        if CACHE_FILE.exists():
            try:
                self.query_cache = json.loads(CACHE_FILE.read_text())
            except Exception:
                self.query_cache = {}

    def _save_cache(self):
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(self.query_cache, indent=2))

    def discover_schema(self):
        """Discover all tables and columns. Called on first query or startup."""
        if self.schema:
            return  # Already discovered
        if not self.stoa or not self.stoa.connected:
            return

        try:
            rows = self.stoa.query("""
                SELECT TABLE_SCHEMA + '.' + TABLE_NAME as table_name, COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
            """)
            for row in rows:
                table = row.get("table_name", "")
                col = row.get("COLUMN_NAME", "")
                if table not in self.schema:
                    self.schema[table] = []
                self.schema[table].append(col)
            logger.info(f"Schema discovered: {len(self.schema)} tables, {sum(len(v) for v in self.schema.values())} columns")
        except Exception as e:
            logger.error(f"Schema discovery failed: {e}")

    def _find_relevant_tables(self, user_message: str) -> list[tuple[str, float]]:
        """Score tables by relevance to the user's question. Returns [(table, score)]."""
        if not self.schema:
            self.discover_schema()
        if not self.schema:
            return []

        lower = user_message.lower()
        words = set(re.findall(r'[a-z]{3,}', lower))

        scored = []
        for table, columns in self.schema.items():
            score = 0
            table_lower = table.lower()
            table_parts = set(re.findall(r'[a-z]{3,}', table_lower))
            col_text = " ".join(columns).lower()
            col_parts = set(re.findall(r'[a-z]{3,}', col_text))

            # Table name matches
            for w in words:
                if w in table_lower:
                    score += 10
                # Partial matches (e.g. "property" matches "PropertyList")
                for tp in table_parts:
                    if w in tp or tp in w:
                        score += 5

            # Column name matches
            for w in words:
                if w in col_text:
                    score += 3
                for cp in col_parts:
                    if w in cp or cp in w:
                        score += 2

            # Boost leasing/property tables for common real estate terms
            re_terms = {"occupancy", "rent", "lease", "unit", "property", "pricing", "tenant", "renewal", "velocity"}
            if words & re_terms and any(kw in table_lower for kw in ["leasing", "property", "project", "unit"]):
                score += 8

            if score > 0:
                scored.append((table, score))

        scored.sort(key=lambda x: -x[1])
        return scored[:5]  # Top 5 most relevant

    def _generate_sql(self, table: str, user_message: str) -> str:
        """Generate a SQL query for a table based on the user's question."""
        columns = self.schema.get(table, [])
        lower = user_message.lower()

        # Detect if asking about a specific entity
        # Look for property names, places, etc.
        name_cols = [c for c in columns if any(kw in c.lower() for kw in ["name", "title", "description", "property", "project"])]
        
        # Build WHERE clause for specific lookups
        where_parts = []
        # Extract potential entity names (capitalized words, quoted strings)
        quoted = re.findall(r'"([^"]+)"', user_message)
        named = re.findall(r'(?:the |at |about |for )([A-Z][a-z]+(?: [A-Za-z]+)*)', user_message)
        search_terms = quoted + named
        
        # Also check common property keywords
        for kw in ["heights", "picardy", "campus", "stoa"]:
            if kw in lower and kw not in [s.lower() for s in search_terms]:
                search_terms.append(kw)

        if search_terms and name_cols:
            for col in name_cols[:2]:
                for term in search_terms:
                    where_parts.append(f"[{col}] LIKE '%{term}%'")

        # Detect ordering intent
        order = ""
        if any(w in lower for w in ["highest", "top", "best", "most", "maximum", "max"]):
            # Find numeric columns to sort by
            num_cols = [c for c in columns if any(kw in c.lower() for kw in ["rate", "occupancy", "total", "amount", "count", "revenue", "income", "price", "rent"])]
            if num_cols:
                order = f"ORDER BY [{num_cols[0]}] DESC"
        elif any(w in lower for w in ["lowest", "bottom", "worst", "least", "minimum", "min"]):
            num_cols = [c for c in columns if any(kw in c.lower() for kw in ["rate", "occupancy", "vacancy", "amount", "cost", "expense"])]
            if num_cols:
                order = f"ORDER BY [{num_cols[0]}] ASC"
        elif any(w in lower for w in ["latest", "recent", "newest", "last", "current", "today", "yesterday"]):
            date_cols = [c for c in columns if any(kw in c.lower() for kw in ["date", "created", "updated", "time", "day"])]
            if date_cols:
                order = f"ORDER BY [{date_cols[0]}] DESC"

        if not order:
            order = "ORDER BY 1 DESC"

        where_clause = f"WHERE {' OR '.join(where_parts)}" if where_parts else ""
        
        return f"SELECT TOP 15 * FROM [{table.split('.')[0]}].[{table.split('.')[1] if '.' in table else table}] {where_clause} {order}"

    def should_query_stoa(self, user_message: str) -> bool:
        """Check if this message warrants a database query."""
        lower = user_message.lower()
        stoa_keywords = [
            "property", "properties", "occupancy", "noi", "rent", "lease",
            "loan", "bank", "deal", "contract", "vendor", "stoa", "campus",
            "portfolio", "unit", "pricing", "metrics", "heights", "picardy",
            "highest", "lowest", "top", "bottom", "best", "worst",
            "how many", "total", "average", "list", "show me", "query",
            "data", "database", "table", "what's the",
        ]
        return any(kw in lower for kw in stoa_keywords)

    def get_data_context(self, user_message: str) -> Optional[str]:
        """Self-discovering: find relevant tables, generate SQL, run it, return results."""
        if not self.stoa:
            return None
        if not self.stoa.connected:
            try:
                self.stoa.connect()
            except Exception:
                pass
            if not self.stoa.connected:
                return None

        if not self.should_query_stoa(user_message):
            return None

        self.query_count += 1
        logger.info(f"Query planner triggered: '{user_message[:60]}'")

        # Discover schema if not done
        self.discover_schema()

        # Check cache first
        cache_key = re.sub(r'[^a-z ]+', '', user_message.lower()).strip()[:50]
        if cache_key in self.query_cache:
            try:
                rows = self.stoa.query(self.query_cache[cache_key])
                if rows:
                    logger.info(f"  Cache hit: {len(rows)} rows")
                    return self._format_results([{"type": "cached", "rows": rows}])
            except Exception:
                del self.query_cache[cache_key]

        # Find relevant tables
        relevant = self._find_relevant_tables(user_message)
        if not relevant:
            logger.info("  No relevant tables found")
            # Last resort: dump table list
            tables = list(self.schema.keys())
            if tables:
                return f"[STOA DATABASE — {len(tables)} tables available but couldn't determine which to query.\nAvailable tables: {', '.join(tables[:30])}\nAsk the user to be more specific about what data they want.]"
            return None

        logger.info(f"  Relevant tables: {[(t, s) for t, s in relevant[:3]]}")

        # Generate and try queries
        all_results = []
        for table, score in relevant[:3]:
            sql = self._generate_sql(table, user_message)
            logger.info(f"  Trying: {sql[:80]}...")
            try:
                rows = self.stoa.query(sql)
                if rows:
                    all_results.append({"type": table, "sql": sql, "rows": rows[:15]})
                    logger.info(f"  ✓ {table}: {len(rows)} rows")
                    # Cache successful query
                    self.query_cache[cache_key] = sql
                    self._save_cache()
                    break  # Got good results
                else:
                    logger.info(f"  ✗ {table}: 0 rows")
                    # Try without WHERE clause
                    simple_sql = f"SELECT TOP 15 * FROM [{table.split('.')[0]}].[{table.split('.')[1] if '.' in table else table}] ORDER BY 1 DESC"
                    rows = self.stoa.query(simple_sql)
                    if rows:
                        all_results.append({"type": table, "sql": simple_sql, "rows": rows[:15]})
                        logger.info(f"  ✓ {table} (no filter): {len(rows)} rows")
                        self.query_cache[cache_key] = simple_sql
                        self._save_cache()
                        break
            except Exception as e:
                logger.info(f"  ✗ {table}: {e}")
                # Try simpler query
                try:
                    simple_sql = f"SELECT TOP 10 * FROM {table}"
                    rows = self.stoa.query(simple_sql)
                    if rows:
                        all_results.append({"type": table, "sql": simple_sql, "rows": rows[:10]})
                        logger.info(f"  ✓ {table} (simple): {len(rows)} rows")
                        break
                except Exception:
                    pass

        if not all_results:
            self.successful_queries  # Don't increment
            return None

        self.successful_queries += 1
        return self._format_results(all_results)

    def _format_results(self, all_results: list[dict]) -> str:
        """Format query results into a context string for the LLM."""
        parts = [
            "[STOA DATABASE — REAL DATA from stoagroupDB. Present this data to the user.]",
            "[DO NOT make up data. Only use what's in the tables below.]",
            "",
        ]

        for result in all_results:
            rows = result.get("rows", [])
            if not rows:
                continue
            cols = list(rows[0].keys())
            rtype = result.get("type", "data")
            parts.append(f"### {rtype} ({len(rows)} rows)")
            # Header
            parts.append("| " + " | ".join(str(c) for c in cols[:12]) + " |")
            parts.append("| " + " | ".join("---" for _ in cols[:12]) + " |")
            for row in rows:
                vals = []
                for c in cols[:12]:
                    v = str(row.get(c, "") or "")
                    if len(v) > 35:
                        v = v[:35] + "…"
                    vals.append(v)
                parts.append("| " + " | ".join(vals) + " |")
            parts.append("")

        return "\n".join(parts)

    def get_stats(self) -> dict:
        return {
            "queries_attempted": self.query_count,
            "successful_queries": self.successful_queries,
            "schema_tables": len(self.schema),
            "schema_columns": sum(len(v) for v in self.schema.values()),
            "cached_queries": len(self.query_cache),
            "stoa_connected": self.stoa.connected if self.stoa else False,
        }
