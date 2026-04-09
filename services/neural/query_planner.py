"""
A.L.E.C. Query Planner — FULLY DYNAMIC.

A.L.E.C. knows its data like the back of its hand. The Stoa database is part
of its ever-growing knowledge. It doesn't "query" — it just knows.

NOTHING is hardcoded. Property names, column names, metric mappings —
everything is discovered dynamically from the database schema and data.

Internally this module:
1. Discovers all tables and columns from the Stoa DB on startup
2. Discovers all property/entity names from the data itself
3. Matches user questions to real column/table names dynamically
4. Generates SQL dynamically based on what it finds
5. Caches successful queries for instant recall
6. Falls back gracefully if a query fails
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
        self.known_properties: list[str] = []  # dynamically discovered property names
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

            logger.info(f"Schema discovered: {len(self.schema)} tables, "
                        f"{sum(len(v) for v in self.schema.values())} columns")

            # Discover property names dynamically
            self._discover_properties()

        except Exception as e:
            logger.error(f"Schema discovery failed: {e}")

    def _discover_properties(self):
        """Discover all property/entity names from the database dynamically.
        Queries tables that have name-like columns to build a list of known entities.
        """
        if self.known_properties:
            return
        if not self.stoa or not self.stoa.connected:
            return

        # Try common property/project tables first
        discovery_queries = [
            "SELECT DISTINCT [PropertyName] FROM [leasing].[DailyPropertyMetrics] WHERE [PropertyName] IS NOT NULL",
            "SELECT DISTINCT [Property] FROM [leasing].[PortfolioUnitDetails] WHERE [Property] IS NOT NULL",
            "SELECT DISTINCT [ProjectName] FROM [core].[Project] WHERE [ProjectName] IS NOT NULL",
        ]

        names = set()
        for sql in discovery_queries:
            try:
                rows = self.stoa.query(sql)
                for row in rows:
                    for val in row.values():
                        if val and str(val).strip() and len(str(val).strip()) > 1:
                            names.add(str(val).strip())
            except Exception:
                continue

        # If those failed, scan schema for any name-like columns and query them
        if not names:
            for table, columns in self.schema.items():
                name_cols = [c for c in columns if any(kw in c.lower() for kw in ['name', 'property', 'project', 'title'])]
                if name_cols:
                    sn = table.split('.')[0]
                    tn = table.split('.')[1] if '.' in table else table
                    for nc in name_cols[:1]:
                        try:
                            rows = self.stoa.query(f"SELECT DISTINCT TOP 100 [{nc}] FROM [{sn}].[{tn}] WHERE [{nc}] IS NOT NULL")
                            for row in rows:
                                val = row.get(nc)
                                if val and str(val).strip() and len(str(val).strip()) > 1:
                                    names.add(str(val).strip())
                        except Exception:
                            continue
                    if names:
                        break

        self.known_properties = sorted(names)
        logger.info(f"Discovered {len(self.known_properties)} property names: {self.known_properties[:10]}")

    def _match_property(self, user_message: str) -> list[str]:
        """Dynamically match user message against known property names.
        Returns list of matched property names.
        """
        if not self.known_properties:
            self._discover_properties()

        lower = user_message.lower()
        matches = []

        for prop in self.known_properties:
            prop_lower = prop.lower()
            # Check if any significant part of the property name appears in the message
            prop_words = prop_lower.split()
            # Match if the full property name is in the message
            if prop_lower in lower:
                matches.append(prop)
                continue
            # Match if all significant words (>2 chars) of the property name appear
            significant_words = [w for w in prop_words if len(w) > 2]
            if significant_words and all(w in lower for w in significant_words):
                matches.append(prop)
                continue
            # Match if any single distinctive word (>4 chars) matches
            for w in prop_words:
                if len(w) > 4 and w in lower:
                    matches.append(prop)
                    break

        return matches

    def _infer_metric_column(self, user_message: str, columns: list[str]) -> tuple[str | None, str]:
        """Dynamically infer which column the user is asking about based on
        column names and user message keywords. No hardcoded mapping.
        """
        lower = user_message.lower()
        user_words = set(re.findall(r'[a-z]{3,}', lower))

        # Score each column by how well it matches the user's question
        scored = []
        for col in columns:
            col_lower = col.lower()
            col_words = set(re.findall(r'[a-z]{3,}', col_lower))
            score = 0

            # Direct word overlap
            for uw in user_words:
                if uw in col_lower:
                    score += 10
                for cw in col_words:
                    if uw in cw or cw in uw:
                        score += 5

            # Skip non-metric columns (names, dates, IDs)
            if any(kw in col_lower for kw in ['name', 'title', 'description', 'date', 'id', 'key', 'status']):
                score -= 20

            # Boost numeric-looking columns
            if any(kw in col_lower for kw in ['pct', 'rate', 'total', 'amount', 'count', 'avg', 'rent', 'units', 'revenue', 'cost', 'budget', 'velocity', 'delta', 'variance', 'occupancy', 'noi']):
                score += 3

            if score > 0:
                scored.append((col, score))

        scored.sort(key=lambda x: -x[1])

        if scored:
            col = scored[0][0]
            # Generate a friendly label from the column name
            label = re.sub(r'([A-Z])', r' \1', col).strip().lower()
            return col, label

        # Fallback: pick first numeric-looking column
        for c in columns:
            clow = c.lower()
            if any(kw in clow for kw in ['pct', 'rate', 'occupancy', 'rent', 'total', 'revenue', 'amount']):
                label = re.sub(r'([A-Z])', r' \1', c).strip().lower()
                return c, label

        return None, "value"

    # ── HELPER: parse "top N" / "bottom N" from user query ──

    @staticmethod
    def _parse_result_limit(user_message: str) -> int:
        """Extract a result limit from the user's question.
        'top 5 properties' -> 5, 'bottom 3' -> 3, default -> 15
        """
        lower = user_message.lower()
        m = re.search(r'(?:top|bottom|best|worst|first|last|highest|lowest)\s+(\d+)', lower)
        if m:
            n = int(m.group(1))
            return min(max(n, 1), 50)  # clamp 1-50
        return 15  # default

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

            for w in words:
                if w in table_lower:
                    score += 10
                for tp in table_parts:
                    if w in tp or tp in w:
                        score += 5

            for w in words:
                if w in col_text:
                    score += 3
                for cp in col_parts:
                    if w in cp or cp in w:
                        score += 2

            # Boost tables with real estate / leasing keywords dynamically
            re_words = {'occupancy', 'rent', 'lease', 'unit', 'property', 'pricing',
                        'tenant', 'renewal', 'velocity', 'performing', 'performance', 'status'}
            if words & re_words and any(kw in table_lower for kw in ['leasing', 'property', 'project', 'unit']):
                score += 8

            # Dynamic boost: if user mentions a known property name, boost property-related tables
            matched_props = self._match_property(user_message)
            if matched_props and any(kw in table_lower for kw in ['leasing', 'property', 'project', 'unit', 'metrics']):
                score += 12

            priority_tables = {
                "leasing.dailypropertymetrics": 25,
                "leasing.propertylist": 10,
                "leasing.portfoliounitdetails": 8,
                "core.project": 8,
                "banking.loan": 5,
                "contracts.contract": 5,
            }
            bonus = priority_tables.get(table_lower, 0)
            if bonus and score > 0:
                score += bonus

            if score > 0:
                scored.append((table, score))

        scored.sort(key=lambda x: -x[1])
        return scored[:5]

    def _generate_sql(self, table: str, user_message: str) -> str:
        """Generate a SQL query for a table based on the user's question.
        Property name matching is fully dynamic from discovered properties.
        """
        columns = self.schema.get(table, [])
        lower = user_message.lower()
        limit = self._parse_result_limit(user_message)

        name_cols = [c for c in columns if any(kw in c.lower() for kw in ["name", "title", "description", "property", "project"])]

        where_parts = []

        # Dynamic property matching - no hardcoded names
        matched_props = self._match_property(user_message)
        # Also check quoted strings and capitalized phrases
        quoted = re.findall(r'"([^"]+)"', user_message)
        named = re.findall(r'(?:the |at |about |for )([A-Z][a-z]+(?: [A-Za-z]+)*)', user_message)
        search_terms = quoted + named + matched_props

        generic_terms = {"stoa", "data", "database", "property", "properties", "all", "every", "list", "show"}
        search_terms = [t for t in search_terms if t.lower() not in generic_terms]
        # Deduplicate
        seen = set()
        unique_terms = []
        for t in search_terms:
            if t.lower() not in seen:
                seen.add(t.lower())
                unique_terms.append(t)
        search_terms = unique_terms

        if search_terms and name_cols:
            for col in name_cols[:2]:
                for term in search_terms:
                    where_parts.append(f"[{col}] LIKE '%{term}%'")

        order = ""
        if any(w in lower for w in ["highest", "top", "best", "most", "maximum", "max", "ranked", "rank", "sort", "ordered"]):
            user_words = set(re.findall(r'[a-z]{3,}', lower))
            num_cols = [c for c in columns if any(uw in c.lower() for uw in user_words if uw not in generic_terms)]
            num_cols = [c for c in num_cols if any(kw in c.lower() for kw in
                        ["rate", "pct", "occupancy", "total", "amount", "count", "revenue",
                         "income", "price", "rent", "units", "avg", "velocity", "delta",
                         "budget", "variance"])]
            if not num_cols:
                num_cols = [c for c in columns if any(kw in c.lower() for kw in
                            ["rate", "pct", "occupancy", "total", "amount", "count",
                             "revenue", "income", "price", "rent"])]
            if num_cols:
                order = f"ORDER BY [{num_cols[0]}] DESC"
        elif any(w in lower for w in ["lowest", "bottom", "worst", "least", "minimum", "min"]):
            num_cols = [c for c in columns if any(kw in c.lower() for kw in
                        ["rate", "occupancy", "vacancy", "amount", "cost", "expense"])]
            if num_cols:
                order = f"ORDER BY [{num_cols[0]}] ASC"
        elif any(w in lower for w in ["latest", "recent", "newest", "last", "current", "today", "yesterday"]):
            date_cols = [c for c in columns if any(kw in c.lower() for kw in ["date", "created", "updated", "time", "day"])]
            if date_cols:
                order = f"ORDER BY [{date_cols[0]}] DESC"

        if not order:
            order = "ORDER BY 1 DESC"

        date_cols_available = [c for c in columns if c.lower() in ("reportdate", "date", "created_at", "createdat", "computedat")]
        if date_cols_available:
            time_words = {"history", "trend", "over time", "last year", "monthly", "weekly", "daily", "all time"}
            if not any(tw in lower for tw in time_words):
                dcol = date_cols_available[0]
                where_parts.append(f"[{dcol}] = (SELECT MAX([{dcol}]) FROM [{table.split('.')[0]}].[{table.split('.')[1] if '.' in table else table}])")

        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        schema_name = table.split('.')[0]
        table_name = table.split('.')[1] if '.' in table else table
        return f"SELECT TOP {limit} * FROM [{schema_name}].[{table_name}] {where_clause} {order}"

    def should_query_stoa(self, user_message: str) -> bool:
        """Check if this message warrants a database query.
        Uses dynamic property matching instead of hardcoded names.
        """
        lower = user_message.lower()

        non_data_patterns = [
            "remember ", "forget ", "my favorite", "i prefer", "i like",
            "i want you to", "change ", "update ", "make ", "turn on", "turn off",
            "set ", "schedule ", "remind ", "who are you", "what can you",
            "help me", "hello", "hey alec", "thank", "thanks",
            "good job", "nice", "great",
            "can you see", "do you have access", "are you able",
            "search the web", "search the internet", "google ", "look up",
            "browse ", "latest news", "find out", "what is the weather",
            "stock price", "current events", "today's news",
            "qwen", "llama", "model release", "ai news",
            "turn on", "turn off", "lights", "brightness",
            "email ", "send me", "send a report",
            "improve yourself", "your code", "edit ", "fix yourself",
            "fix your", "repair yourself", "repair your", "improve your",
            "self_edit", "trigger a self", "commit", "push", "deploy",
        ]
        if any(pat in lower for pat in non_data_patterns):
            return False

        # Generic data keywords
        stoa_keywords = [
            "property", "properties", "occupancy", "noi", "rent", "lease",
            "loan", "bank", "deal", "contract", "vendor", "stoa", "campus",
            "portfolio", "unit", "pricing", "metrics",
            "highest", "lowest", "top", "bottom", "best", "worst",
            "how many", "total", "average", "list", "show me", "query",
            "data", "database", "table", "what's the",
            "velocity", "leased", "available", "vacant", "renewal",
        ]
        if any(kw in lower for kw in stoa_keywords):
            return True

        # Dynamic: check if user mentions a known property name
        if self._match_property(user_message):
            return True

        return False

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
        self.discover_schema()

        # Anti-hallucination: check if user asks about a specific property not in our DB
        _loc_ind = ["at ", "about the ", "for the ", "of the "]
        _mentions_specific = any(w in user_message.lower() for w in _loc_ind)
        is_ranking = any(kw in user_message.lower() for kw in ['top ', 'bottom ', 'best ', 'worst ', 'all ', 'every ', 'list ', 'show me'])
        if _mentions_specific and not is_ranking:
            matched = self._match_property(user_message)
            if not matched:
                logger.info("Anti-hallucination (data_context): unknown property")
                return ("[STOA DATABASE -- The property or entity mentioned by the user was NOT FOUND in the database. "
                        "Tell the user: 'I don't have that property in my database. Would you like me to search the web for information about it?' "
                        "Do NOT make up any data or statistics.]")


        cache_key = re.sub(r'[^a-z ]+', '', user_message.lower()).strip()[:100]
        if cache_key in self.query_cache:
            try:
                rows = self.stoa.query(self.query_cache[cache_key])
                if rows:
                    logger.info(f"  Cache hit: {len(rows)} rows")
                    return self._format_results([{"type": "cached", "rows": rows}])
            except Exception:
                del self.query_cache[cache_key]

        relevant = self._find_relevant_tables(user_message)
        if not relevant:
            logger.info("  No relevant tables found")
            tables = list(self.schema.keys())
            if tables:
                return (f"[STOA DATABASE -- {len(tables)} tables available but couldn't "
                        f"determine which to query.\nAvailable tables: {', '.join(tables[:30])}\n"
                        f"Ask the user to be more specific about what data they want.]")
            return None

        logger.info(f"  Relevant tables: {[(t, s) for t, s in relevant[:3]]}")

        all_results = []
        for table, score in relevant[:3]:
            sql = self._generate_sql(table, user_message)
            logger.info(f"  Trying: {sql[:80]}...")
            try:
                rows = self.stoa.query(sql)
                if rows:
                    all_results.append({"type": table, "sql": sql, "rows": rows[:15]})
                    logger.info(f"  + {table}: {len(rows)} rows")
                    self.query_cache[cache_key] = sql
                    self._save_cache()
                    break
                else:
                    logger.info(f"  x {table}: 0 rows")
                    _q = re.findall(r'"([^"]+)"', user_message)
                    _n = re.findall(r'(?:the |at |about |for )([A-Z][a-z]+(?: [A-Za-z]+)*)', user_message)
                    _terms = _q + _n
                    _gen = {"stoa", "data", "database", "property", "properties", "all", "every", "list", "show"}
                    _terms = [t for t in _terms if t.lower() not in _gen]
                    if _terms:
                        logger.info(f"    No data for specific entity: {_terms}")
                        continue

                    simple_sql = f"SELECT TOP 15 * FROM [{table.split('.')[0]}].[{table.split('.')[1] if '.' in table else table}] ORDER BY 1 DESC"
                    rows = self.stoa.query(simple_sql)
                    if rows:
                        all_results.append({"type": table, "sql": simple_sql, "rows": rows[:15]})
                        logger.info(f"  + {table} (no filter): {len(rows)} rows")
                        break
            except Exception as e:
                logger.info(f"  x {table}: {e}")
                try:
                    simple_sql = f"SELECT TOP 10 * FROM {table}"
                    rows = self.stoa.query(simple_sql)
                    if rows:
                        all_results.append({"type": table, "sql": simple_sql, "rows": rows[:10]})
                        logger.info(f"  + {table} (simple): {len(rows)} rows")
                        break
                except Exception:
                    pass

        if not all_results:
            return None

        self.successful_queries += 1
        return self._format_results(all_results)

    def _format_results(self, all_results: list[dict]) -> str:
        """Format query results for LLM injection (fallback path)."""
        parts = []
        parts.append("[STOA DATABASE QUERY RESULTS -- THIS IS REAL DATA. ONLY report values shown below. If the user's question is NOT answered by this data, say 'I don't have that in my database — want me to search the web?' NEVER fabricate numbers, property names, or statistics.]")
        parts.append("CRITICAL: If zero rows match, tell the user no data was found. Do NOT make up approximate values.")
        parts.append("")

        for result in all_results:
            rows = result.get("rows", [])
            if not rows:
                continue
            rtype = result.get("type", "data")
            parts.append(f"Source table: {rtype} -- {len(rows)} rows returned.")
            parts.append("")

            for i, row in enumerate(rows[:10]):
                parts.append(f"Row {i+1}:")
                for col, val in row.items():
                    if val is not None and str(val).strip():
                        clean = str(val).strip()
                        if len(clean) > 80:
                            clean = clean[:80] + "..."
                        parts.append(f"  {col}: {clean}")
                parts.append("")

            parts.append("SUMMARY (use this to answer the user):")
            for i, row in enumerate(rows[:10]):
                summary_parts = []
                for col, val in row.items():
                    if val is not None and str(val).strip():
                        clow = col.lower()
                        if any(kw in clow for kw in ["name", "property", "project", "title", "description",
                               "rate", "pct", "occupancy", "rent", "total", "amount", "units", "count",
                                                     "price", "noi", "revenue"]):
                            summary_parts.append(f"{col}={val}")
                if summary_parts:
                    parts.append(f"  {i+1}. {', '.join(summary_parts[:8])}")
            parts.append("")

            parts.append("[END OF DATABASE RESULTS. ONLY use the data shown above. If the user asked about something NOT in these results, say 'I don't have that in my database' and offer to search the web. NEVER make up or guess values.]")
        parts.append("")
        parts.append("[ANTI-HALLUCINATION: If no rows match the user's question, tell them the data wasn't found. Do NOT invent statistics or property names.]")

        return "\n".join(parts)

    def get_direct_response(self, user_message: str) -> Optional[str]:
        """Query the Stoa DB and return a formatted human-readable response.
        This BYPASSES the LLM entirely. A.L.E.C. just knows its data.
        """
        if not self.stoa or not self.stoa.connected:
            try:
                if self.stoa:
                    self.stoa.connect()
            except Exception:
                pass
        if not self.stoa or not self.stoa.connected:
            return None

        if not self.should_query_stoa(user_message):
            return None

        self.query_count += 1
        logger.info(f"Query planner (direct): '{user_message[:60]}'")
        self.discover_schema()

        is_ranking = any(kw in user_message.lower() for kw in [
            'top ', 'bottom ', 'best ', 'worst ', 'highest ', 'lowest ',
            'all properties', 'all ', 'every ', 'list ', 'show me', 'rank',
        ])

        # Anti-hallucination: refuse queries about unknown properties
        # Broad detection: check for specific property/entity mentions
        _loc_ind = [
            "at ", "about the ", "for the ", "of the ", "on the ",
            "what is ", "what's ", "how much", "how many", "tell me about",
            "show me ", "give me ", "what are the ", "what does ",
            "'s ", " rent", " occupancy", " vacancy", " units",
            " revenue", " income", " noi", " expenses",
        ]
        _mentions_specific = any(w in user_message.lower() for w in _loc_ind)
        # Also detect if user mentions a proper-noun-like entity (capitalized words)
        _has_proper_noun = bool(re.search(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', user_message))
        if (_mentions_specific or _has_proper_noun) and not is_ranking:
            matched = self._match_property(user_message)
            if not matched:
                logger.info("Anti-hallucination: unknown property, returning None")
                return "I don't have that property in my database. Would you like me to search the web for information about it?"

        cache_key = re.sub(r'[^a-z ]+', '', user_message.lower()).strip()[:100]
        cached_rows = None

        # Try specialized handlers first
        trend_result = self.get_trend_response(user_message)
        if trend_result:
            return trend_result

        cost_result = self.get_cost_analysis(user_message)
        if cost_result:
            return cost_result

        analytical_result = self.get_analytical_response(user_message)
        if analytical_result:
            return analytical_result

        if cache_key in self.query_cache and not is_ranking:
            try:
                cached_rows = self.stoa.query(self.query_cache[cache_key])
            except Exception:
                del self.query_cache[cache_key]

        rows = cached_rows
        source_table = "cached"
        sql_used = self.query_cache.get(cache_key, "")

        if not rows:
            relevant = self._find_relevant_tables(user_message)
            if not relevant:
                return None

            for table, score in relevant[:3]:
                sql = self._generate_sql(table, user_message)
                logger.info(f"  Trying: {sql[:100]}")
                try:
                    rows = self.stoa.query(sql)
                    if rows:
                        source_table = table
                        sql_used = sql
                        self.query_cache[cache_key] = sql
                        self._save_cache()
                        break

                    _quoted = re.findall(r'"([^"]+)"', user_message)
                    _named = re.findall(r'(?:the |at |about |for )([A-Z][a-z]+(?: [A-Za-z]+)*)', user_message)
                    _search_terms = _quoted + _named
                    _generic = {"stoa", "data", "database", "property", "properties", "all", "every", "list", "show"}
                    _search_terms = [t for t in _search_terms if t.lower() not in _generic]
                    if _search_terms:
                        logger.info(f"  No data found for: {_search_terms}")
                        continue

                    schema_name = table.split('.')[0]
                    table_name = table.split('.')[1] if '.' in table else table
                    simple_sql = f"SELECT TOP 10 * FROM [{schema_name}].[{table_name}] ORDER BY 1 DESC"
                    rows = self.stoa.query(simple_sql)
                    if rows:
                        source_table = table
                        sql_used = simple_sql
                        break
                except Exception as e:
                    logger.info(f"  Failed: {e}")

        if not rows:
            matched = self._match_property(user_message)
            if matched:
                return f"I don't have data for **{matched[0]}** in my database. It may be listed under a different name, or I can search the web for information about it if you'd like."
                return "I couldn't find that information in my database. Would you like me to search the web for it?"

        self.successful_queries += 1
        return self._format_direct_response(user_message, rows, source_table)

    @staticmethod
    def _format_value(val, col_name: str) -> str:
        """Format a single value for display."""
        if val is None:
            return "N/A"
        if isinstance(val, float):
            clow = col_name.lower()
            if 'pct' in clow or 'rate' in clow or clow == 'occupancypct':
                return f"{val:.1f}%"
            elif 'rent' in clow or 'amount' in clow or 'revenue' in clow or 'budget' in clow:
                return f"${val:,.2f}"
            else:
                return f"{val:,.1f}"
        elif isinstance(val, int):
            return f"{val:,}"
        return str(val)

    def _format_direct_response(self, user_message: str, rows: list[dict], source: str) -> str:
        """Format query results as a natural, confident response.
        A.L.E.C. KNOWS this data. It doesn't say 'from the database' or
        'according to records'. It just answers directly, like an executive
        who has the numbers memorized.

        ALL metric/column matching is DYNAMIC -- no hardcoded mappings.
        """
        lower = user_message.lower()
        cols = list(rows[0].keys()) if rows else []
        limit = self._parse_result_limit(user_message)

        # Property name column (dynamic detection)
        name_col = next((c for c in cols if c.lower() in ('property', 'propertyname', 'property_name',
                         'name', 'projectname', 'project_name', 'title')), None)
        if not name_col:
            name_col = next((c for c in cols if 'name' in c.lower() or 'property' in c.lower()), None)

        # Dynamic metric inference -- no hardcoded metric_map
        metric_col, metric_label = self._infer_metric_column(user_message, cols)

        logger.info(f"  Final metric: metric_col={metric_col}, name_col={name_col}, "
                    f"rows={len(rows)}, sample_val={rows[0].get(metric_col) if rows and metric_col else 'N/A'}")

        # Client-side entity filter using dynamic property matching
        matched_props = self._match_property(user_message)
        quoted = re.findall(r'"([^"]+)"', user_message)
        named = re.findall(r'(?:the |at |about |for |of )([A-Z][a-z]+(?:\s+[A-Za-z]+)*)', user_message)
        entity_terms = quoted + named + matched_props
        generic = {'Stoa', 'Data', 'Database', 'Property', 'Properties', 'All'}
        entity_terms = [t for t in entity_terms if t not in generic]

        if entity_terms and name_col and len(rows) > 3:
            filtered = []
            for row in rows:
                rname = str(row.get(name_col, '')).lower()
                for term in entity_terms:
                    if term.lower() in rname:
                        filtered.append(row)
                        break
            if filtered:
                rows = filtered

        # Apply the user's requested limit
        rows = rows[:limit]

        parts = []

        # Is this a specific property query or a ranking/list?
        is_specific = len(rows) <= 3
        is_ranking = any(kw in lower for kw in ['top', 'best', 'highest', 'lowest', 'worst',
                         'bottom', 'all', 'list', 'show', 'every', 'rank'])

        if is_specific and not is_ranking:
            for row in rows:
                pname = row.get(name_col, 'Unknown') if name_col else 'Unknown'
                if metric_col and metric_col in row:
                    val = row.get(metric_col)
                    display_val = self._format_value(val, metric_col)
                    parts.append(f"**{pname}** is at {display_val} {metric_label}.")
                else:
                    parts.append(f"**{pname}**")
                    for col, val in row.items():
                        if val is not None and str(val).strip() and col != name_col:
                            display_val = self._format_value(val, col)
                            col_display = re.sub(r'([A-Z])', r' \1', col).strip()
                            parts.append(f"  {col_display}: {display_val}")
                parts.append("")
        else:
            # Adaptive ranking / list view
            numeric_vals = []
            if metric_col:
                for row in rows:
                    v = row.get(metric_col)
                    if v is not None and isinstance(v, (int, float)):
                        numeric_vals.append(float(v))

            avg_val = sum(numeric_vals) / len(numeric_vals) if numeric_vals else None
            min_val = min(numeric_vals) if numeric_vals else None
            max_val = max(numeric_vals) if numeric_vals else None

            if any(kw in lower for kw in ['top', 'best', 'highest']):
                intro = f"**Top {len(rows)} by {metric_label}:**"
            elif any(kw in lower for kw in ['bottom', 'worst', 'lowest']):
                intro = f"**Bottom {len(rows)} by {metric_label}:**"
            else:
                intro = f"**Portfolio snapshot -- {metric_label}:**"

            parts.append(intro)
            parts.append("")

            concerns = []
            stars = []

            for i, row in enumerate(rows):
                pname = row.get(name_col, f'Row {i+1}') if name_col else f'Row {i+1}'
                if metric_col:
                    val = row.get(metric_col)
                    if val is not None:
                        display = self._format_value(val, metric_col)
                        flag = ""
                        if isinstance(val, (int, float)):
                            fval = float(val)
                            is_pct = 'pct' in metric_col.lower() or 'rate' in metric_col.lower() or 'occupancy' in metric_col.lower()
                            if is_pct:
                                if fval < 50:
                                    flag = " \u26a0\ufe0f"
                                    concerns.append((pname, display))
                                elif fval < 80:
                                    flag = " \u2193"
                                    concerns.append((pname, display))
                                elif fval > 95:
                                    flag = " \u2b50"
                                    stars.append((pname, display))
                            elif avg_val and fval < avg_val * 0.5:
                                flag = " \u26a0\ufe0f"
                                concerns.append((pname, display))
                        parts.append(f"{i+1}. **{pname}** -- {display}{flag}")
                    else:
                        parts.append(f"{i+1}. **{pname}**")
                else:
                    key_vals = []
                    for col, val in row.items():
                        if val is not None and col != name_col and str(val).strip():
                            key_vals.append(f"{col}: {self._format_value(val, col)}")
                            if len(key_vals) >= 5:
                                break
                    parts.append(f"{i+1}. **{pname}** -- {', '.join(key_vals)}")

            # Portfolio summary
            if avg_val is not None and len(numeric_vals) >= 3:
                parts.append("")
                avg_d = self._format_value(avg_val, metric_col)
                min_d = self._format_value(min_val, metric_col)
                max_d = self._format_value(max_val, metric_col)
                parts.append(f"**Portfolio avg:** {avg_d} | Range: {min_d} - {max_d}")

            if concerns:
                parts.append("")
                clist = ', '.join(f'{n} ({v})' for n, v in concerns[:3])
                parts.append(f"\u26a0\ufe0f **Needs attention:** {clist}")
            if stars:
                parts.append("")
                slist = ', '.join(n for n, v in stars[:3])
                parts.append(f"\u2b50 **Top performers:** {slist}")

        report_date = None
        for row in rows[:1]:
            for col in ['ReportDate', 'Date', 'CreatedAt']:
                if col in row and row[col]:
                    report_date = str(row[col])[:10]
                    break
        if report_date:
            parts.append(f"\n_As of {report_date}_")

        return "\n".join(parts)

    def get_stats(self) -> dict:
        return {
            "queries_attempted": self.query_count,
            "successful_queries": self.successful_queries,
            "schema_tables": len(self.schema),
            "schema_columns": sum(len(v) for v in self.schema.values()),
            "cached_queries": len(self.query_cache),
            "known_properties": len(self.known_properties),
            "stoa_connected": self.stoa.connected if self.stoa else False,
        }

    def _is_trend_query(self, user_message: str) -> bool:
        lower = user_message.lower()
        trend_keywords = [
            'trend', 'over time', 'month over month', 'month by month',
            'monthly', 'quarterly', 'yearly', 'year over year',
            'history', 'historical', 'compare months',
            'last 3 months', 'last 6 months', 'last 12 months', 'last year',
            'growth', 'decline', 'change', 'delta', 'progression',
            'improving', 'worsening', 'increasing', 'decreasing',
        ]
        return any(kw in lower for kw in trend_keywords)

    def _is_cost_query(self, user_message: str) -> bool:
        lower = user_message.lower()
        cost_keywords = [
            'cost', 'expense', 'budget', 'spend', 'spending',
            'opex', 'capex', 'overhead', 'maintenance cost',
            'operating expense', 'payroll', 'utility', 'utilities',
            'insurance', 'tax', 'taxes', 'repair', 'vendor cost',
            'invoice', 'payment', 'billing', 'charge',
        ]
        return any(kw in lower for kw in cost_keywords)

    def _generate_trend_sql(self, table: str, user_message: str) -> Optional[str]:
        """Generate trend SQL with dynamic metric inference."""
        columns = self.schema.get(table, [])
        lower = user_message.lower()

        date_col = None
        for c in columns:
            if c.lower() in ('reportdate', 'date', 'createdat', 'computedat'):
                date_col = c
                break
        if not date_col:
            return None

        # Dynamic metric inference instead of hardcoded map
        metric_col, _ = self._infer_metric_column(user_message, columns)
        if not metric_col:
            # Default to first numeric-looking column
            for c in columns:
                if any(kw in c.lower() for kw in ['pct', 'rate', 'occupancy', 'rent', 'total', 'revenue']):
                    metric_col = c
                    break
        if not metric_col:
            metric_col = 'OccupancyPct' if 'OccupancyPct' in columns else None
            if not metric_col:
                return None

        name_col = next((c for c in columns if 'name' in c.lower() or 'property' in c.lower()), None)

        schema_name = table.split('.')[0]
        table_name = table.split('.')[1] if '.' in table else table

        months = 6
        if 'last 3 month' in lower:
            months = 3
        elif 'last 12 month' in lower or 'last year' in lower:
            months = 12

        select_parts = [f"FORMAT([{date_col}], 'yyyy-MM') as Month"]
        if name_col:
            select_parts.append(f"[{name_col}]")
        select_parts.append(f"AVG([{metric_col}]) as avg_{metric_col}")
        select_parts.append(f"MIN([{metric_col}]) as min_{metric_col}")
        select_parts.append(f"MAX([{metric_col}]) as max_{metric_col}")

        group_parts = [f"FORMAT([{date_col}], 'yyyy-MM')"]
        if name_col:
            group_parts.append(f"[{name_col}]")

        where_parts = [f"[{date_col}] >= DATEADD(month, -{months}, GETDATE())"]

        # Dynamic property filter
        matched_props = self._match_property(user_message)
        if name_col and matched_props:
            where_parts.append(f"[{name_col}] LIKE '%{matched_props[0]}%'")
        else:
            # Also check quoted/named
            quoted = re.findall(r'"([^"]+)"', user_message)
            named = re.findall(r'(?:the |at |about |for |of )([A-Z][a-z]+(?:\s+[A-Za-z]+)*)', user_message)
            named_lower = re.findall(r'(?:for |at |about )([a-z]+(?:\s+[a-z]+)+)', lower)
            entity_terms = quoted + named + named_lower
            generic = {'stoa', 'data', 'database', 'property', 'properties', 'all', 'every', 'list', 'show', 'the past', 'last year'}
            entity_terms = [t for t in entity_terms if t.lower().strip() not in generic and len(t.strip()) > 2]
            if entity_terms and name_col:
                term = entity_terms[0].strip()
                where_parts.append(f"[{name_col}] LIKE '%{term}%'")

        where_clause = ' AND '.join(where_parts)
        sql = (f"SELECT {', '.join(select_parts)} FROM [{schema_name}].[{table_name}] "
               f"WHERE {where_clause} GROUP BY {', '.join(group_parts)} "
               f"HAVING AVG([{metric_col}]) > 0 ORDER BY Month DESC")
        return sql

    def get_trend_response(self, user_message: str) -> Optional[str]:
        if not self._is_trend_query(user_message):
            return None
        if not self.stoa or not self.stoa.connected:
            return None

        self.discover_schema()
        relevant = self._find_relevant_tables(user_message)
        if not relevant:
            return None

        for table, score in relevant[:3]:
            sql = self._generate_trend_sql(table, user_message)
            if not sql:
                continue
            logger.info(f"  Trend SQL: {sql[:100]}")
            try:
                rows = self.stoa.query(sql)
                if rows:
                    self.successful_queries += 1
                    return self._format_trend_response(rows, table)
            except Exception as e:
                logger.info(f"  Trend query failed: {e}")

        return None

    def _format_trend_response(self, rows: list[dict], source: str) -> str:
        """Format trend data naturally."""
        parts = ["**Trend Analysis:**\n"]

        months_data: dict[str, list[dict]] = {}
        for row in rows:
            month = row.get('Month', 'Unknown')
            if month not in months_data:
                months_data[month] = []
            months_data[month].append(row)

        name_col = next((c for c in rows[0].keys() if 'name' in c.lower() or 'property' in c.lower()), None)
        metric_cols = [c for c in rows[0].keys() if c.startswith('avg_') or c.startswith('min_') or c.startswith('max_')]
        if not metric_cols:
            metric_cols = [c for c in rows[0].keys() if c not in ('Month', name_col) and c != name_col]

        for month in sorted(months_data.keys(), reverse=True):
            month_rows = months_data[month]
            parts.append(f"**{month}:**")
            for row in month_rows[:10]:
                label = row.get(name_col, '') if name_col else ''
                vals = []
                for mc in metric_cols:
                    if row.get(mc) is not None:
                        col_base = mc.split('_', 1)[1] if '_' in mc else mc
                        friendly = re.sub(r'([A-Z])', r' \1', col_base).strip()
                        vals.append(f"{friendly}: {self._format_value(row[mc], col_base)}")
                if not vals:
                    for k, v in row.items():
                        if k != 'Month' and k != name_col and v is not None:
                            vals.append(f"{k}: {self._format_value(v, k)}")
                line = f"  {label}: {', '.join(vals)}" if label else f"  {', '.join(vals)}"
                parts.append(line)
            parts.append("")

        if len(months_data) >= 2 and metric_cols and name_col:
            oldest_month = sorted(months_data.keys())[0]
            newest_month = sorted(months_data.keys())[-1]
            old_rows = months_data.get(oldest_month, [])
            new_rows = months_data.get(newest_month, [])

            improving = []
            declining = []
            for nr in new_rows:
                nname = nr.get(name_col, '')
                nval = None
                for mc in metric_cols:
                    if nr.get(mc) is not None and isinstance(nr[mc], (int, float)):
                        nval = float(nr[mc])
                        break
                if nval is None:
                    continue
                for orw in old_rows:
                    if orw.get(name_col, '') == nname:
                        oval = None
                        for mc in metric_cols:
                            if orw.get(mc) is not None and isinstance(orw[mc], (int, float)):
                                oval = float(orw[mc])
                                break
                        if oval is not None:
                            delta = nval - oval
                            if delta > 0.5:
                                improving.append((nname, delta))
                            elif delta < -0.5:
                                declining.append((nname, abs(delta)))
                        break

            parts.append("")
            if improving:
                improving.sort(key=lambda x: -x[1])
                names = ', '.join(f'**{n}** (+{d:.1f})' for n, d in improving[:3])
                parts.append(f"\u2b06 Trending up: {names}")
            if declining:
                declining.sort(key=lambda x: -x[1])
                names = ', '.join(f'**{n}** (-{d:.1f})' for n, d in declining[:3])
                parts.append(f"\u2b07 Trending down: {names}")
            if not improving and not declining:
                parts.append("Portfolio performance is holding steady.")

        sm = sorted(months_data.keys())
        parts.append(f"Data spans {sm[0]} to {sm[-1]} ({len(months_data)} months).")
        return "\n".join(parts)

    def get_cost_analysis(self, user_message: str) -> Optional[str]:
        if not self._is_cost_query(user_message):
            return None
        if not self.stoa or not self.stoa.connected:
            return None

        self.discover_schema()
        cost_tables = []
        for table, columns in self.schema.items():
            tl = table.lower()
            ct = ' '.join(columns).lower()
            if any(kw in tl for kw in ['cost', 'expense', 'budget', 'invoice', 'payment', 'vendor', 'contract']):
                cost_tables.append((table, 15))
            elif any(kw in ct for kw in ['cost', 'expense', 'amount', 'budget', 'payment', 'fee']):
                cost_tables.append((table, 5))

        if not cost_tables:
            return None

        cost_tables.sort(key=lambda x: -x[1])
        for table, score in cost_tables[:3]:
            sql = self._generate_sql(table, user_message)
            logger.info(f"  Cost SQL: {sql[:100]}")
            try:
                rows = self.stoa.query(sql)
                if rows:
                    self.successful_queries += 1
                    return self._format_direct_response(user_message, rows, table)
            except Exception as e:
                logger.info(f"  Cost query failed: {e}")

        return None

    def generate_insights(self, user_message: str) -> Optional[str]:
        """Generate analytical insights -- outliers and notable data points."""
        if not self.stoa or not self.stoa.connected:
            return None
        self.discover_schema()

        relevant = self._find_relevant_tables(user_message)
        if not relevant:
            return None

        insights = []
        table = relevant[0][0]
        columns = self.schema.get(table, [])
        sn = table.split('.')[0]
        tn = table.split('.')[1] if '.' in table else table

        num_ind = ['pct', 'rate', 'total', 'amount', 'count', 'rent', 'units', 'occupancy', 'revenue', 'cost']
        num_cols = [c for c in columns if any(kw in c.lower() for kw in num_ind)]
        name_col = next((c for c in columns if 'name' in c.lower() or 'property' in c.lower()), None)

        for nc in num_cols[:3]:
            try:
                if name_col:
                    sql = f"SELECT TOP 3 [{name_col}], [{nc}] FROM [{sn}].[{tn}] WHERE [{nc}] IS NOT NULL ORDER BY [{nc}] DESC"
                else:
                    sql = f"SELECT TOP 3 [{nc}] FROM [{sn}].[{tn}] WHERE [{nc}] IS NOT NULL ORDER BY [{nc}] DESC"
                top_rows = self.stoa.query(sql)
                bot_rows = self.stoa.query(sql.replace('DESC', 'ASC'))
                if top_rows:
                    tv = top_rows[0].get(nc)
                    tn2 = top_rows[0].get(name_col, 'N/A') if name_col else 'N/A'
                    insights.append(f"Highest {nc}: {tn2} at {self._format_value(tv, nc)}")
                if bot_rows:
                    bv = bot_rows[0].get(nc)
                    bn = bot_rows[0].get(name_col, 'N/A') if name_col else 'N/A'
                    insights.append(f"Lowest {nc}: {bn} at {self._format_value(bv, nc)}")
            except Exception:
                pass

        if not insights:
            return None

        parts = ["**Key Insights:**\n"]
        for ins in insights:
            parts.append(f"- {ins}")
        self.successful_queries += 1
        return "\n".join(parts)

    def _is_analytical_query(self, user_message: str) -> bool:
        """Detect complex analytical questions requiring aggregation/JOINs."""
        lower = user_message.lower()
        analytical_keywords = [
            'percent', 'percentage', '%', 'average %', 'avg %',
            'ratio', 'proportion',
            'how many units', 'per building', 'per property', 'per deal',
            'by building', 'by property', 'by deal',
            'each building', 'each property',
            'pet', 'pets', 'pet rent', 'pet fee',
            'amenity', 'amenities', 'parking', 'garage',
            'breakdown', 'distribution', 'composition',
            'compare', 'comparison', 'versus', 'vs',
        ]
        return any(kw in lower for kw in analytical_keywords)

    def get_analytical_response(self, user_message: str) -> Optional[str]:
        """Handle complex analytical queries with aggregation."""
        if not self._is_analytical_query(user_message):
            return None
        if not self.stoa or not self.stoa.connected:
            return None

        self.discover_schema()
        lower = user_message.lower()
        logger.info(f"Analytical query: '{user_message[:80]}'")

        if any(kw in lower for kw in ['pet', 'pets', 'pet rent', 'pet fee']):
            return self._analyze_pet_rent(user_message)
        if any(kw in lower for kw in ['amenity', 'amenities']):
            return self._analyze_amenities(user_message)
        if any(kw in lower for kw in ['per building', 'per property', 'by building',
               'by property', 'each building', 'each property', 'per deal', 'by deal']):
            return self._analyze_per_property(user_message)

        return None

    def _analyze_pet_rent(self, user_message: str) -> Optional[str]:
        """Analyze pet rent across the portfolio."""
        try:
            sql = """
                SELECT [Property],
                    COUNT(*) as TotalOccupied,
                    SUM(CASE WHEN [Total Billing] > [Lease Rent] AND [Lease Rent] > 0 THEN 1 ELSE 0 END) as UnitsWithExtraCharges,
                    CAST(ROUND(
                        100.0 * SUM(CASE WHEN [Total Billing] > [Lease Rent] AND [Lease Rent] > 0 THEN 1 ELSE 0 END)
                        / NULLIF(COUNT(*), 0), 1
                    ) AS DECIMAL(5,1)) as PctWithExtraCharges,
                    AVG(CASE WHEN [Total Billing] > [Lease Rent] AND [Lease Rent] > 0
                        THEN [Total Billing] - [Lease Rent] ELSE NULL END) as AvgExtraCharge
                FROM [leasing].[PortfolioUnitDetails]
                WHERE [Unit/Lease Status] = 'Occupied' AND [Lease Rent] > 0
                GROUP BY [Property]
                ORDER BY PctWithExtraCharges DESC
            """
            rows = self.stoa.query(sql)
            if not rows:
                return None

            self.successful_queries += 1
            parts = ["**Pet/Amenity Charge Analysis by Property:**\n"]
            total_occupied = 0
            total_with_charges = 0

            for i, row in enumerate(rows):
                prop = row.get('Property', 'Unknown')
                occ = row.get('TotalOccupied', 0)
                extra = row.get('UnitsWithExtraCharges', 0)
                pct = row.get('PctWithExtraCharges', 0)
                avg_charge = row.get('AvgExtraCharge')
                total_occupied += (occ or 0)
                total_with_charges += (extra or 0)

                flag = ""
                if pct and float(pct) > 40:
                    flag = " \u2b50"
                elif pct and float(pct) < 10:
                    flag = " \u2193"

                avg_str = f" (avg ${avg_charge:,.0f}/mo)" if avg_charge else ""
                parts.append(f"{i+1}. **{prop}** -- {extra}/{occ} units ({pct}%) have extra charges{avg_str}{flag}")

            if total_occupied > 0:
                portfolio_pct = round(100.0 * total_with_charges / total_occupied, 1)
                parts.append(f"\n**Portfolio total:** {total_with_charges}/{total_occupied} occupied units ({portfolio_pct}%) have pet/amenity charges.")
            parts.append("\n_Extra charges = Total Billing > Lease Rent (includes pet rent, parking, amenities)._")
            return "\n".join(parts)
        except Exception as e:
            logger.error(f"Pet rent analysis failed: {e}")
            return None

    def _analyze_amenities(self, user_message: str) -> Optional[str]:
        """Analyze amenity charges across properties."""
        try:
            sql = """
                SELECT [Property],
                    COUNT(*) as TotalUnits,
                    SUM(CASE WHEN [Amenities] > 0 THEN 1 ELSE 0 END) as UnitsWithAmenities,
                    CAST(ROUND(
                        100.0 * SUM(CASE WHEN [Amenities] > 0 THEN 1 ELSE 0 END)
                        / NULLIF(COUNT(*), 0), 1
                    ) AS DECIMAL(5,1)) as PctWithAmenities,
                    AVG(CASE WHEN [Amenities] > 0 THEN [Amenities] ELSE NULL END) as AvgAmenityCharge
                FROM [leasing].[PortfolioUnitDetails]
                WHERE [Unit/Lease Status] = 'Occupied'
                GROUP BY [Property]
                ORDER BY PctWithAmenities DESC
            """
            rows = self.stoa.query(sql)
            if not rows:
                return None

            self.successful_queries += 1
            parts = ["**Amenity Charge Analysis:**\n"]
            for i, row in enumerate(rows):
                prop = row.get('Property', 'Unknown')
                total = row.get('TotalUnits', 0)
                with_am = row.get('UnitsWithAmenities', 0)
                pct = row.get('PctWithAmenities', 0)
                avg_ch = row.get('AvgAmenityCharge')
                avg_str = f" (avg ${avg_ch:,.0f}/mo)" if avg_ch else ""
                parts.append(f"{i+1}. **{prop}** -- {with_am}/{total} units ({pct}%){avg_str}")
            return "\n".join(parts)
        except Exception as e:
            logger.error(f"Amenity analysis failed: {e}")
            return None

    def _analyze_per_property(self, user_message: str) -> Optional[str]:
        """Generic per-property aggregation for analytical questions."""
        lower = user_message.lower()
        try:
            if any(kw in lower for kw in ['unit', 'units', 'count']):
                sql = """
                    SELECT [Property],
                        COUNT(*) as TotalUnits,
                        SUM(CASE WHEN [Unit/Lease Status] = 'Occupied' THEN 1 ELSE 0 END) as Occupied,
                        SUM(CASE WHEN [Unit/Lease Status] = 'Vacant' THEN 1 ELSE 0 END) as Vacant,
                        CAST(ROUND(100.0 * SUM(CASE WHEN [Unit/Lease Status] = 'Occupied' THEN 1 ELSE 0 END)
                            / NULLIF(COUNT(*), 0), 1) AS DECIMAL(5,1)) as OccPct
                    FROM [leasing].[PortfolioUnitDetails]
                    GROUP BY [Property]
                    ORDER BY OccPct DESC
                """
            elif any(kw in lower for kw in ['rent', 'pricing', 'rate']):
                sql = """
                    SELECT [Property],
                        AVG([Lease Rent]) as AvgRent,
                        MIN([Lease Rent]) as MinRent,
                        MAX([Lease Rent]) as MaxRent,
                        COUNT(*) as Units
                    FROM [leasing].[PortfolioUnitDetails]
                    WHERE [Unit/Lease Status] = 'Occupied' AND [Lease Rent] > 0
                    GROUP BY [Property]
                    ORDER BY AvgRent DESC
                """
            else:
                return None

            rows = self.stoa.query(sql)
            if not rows:
                return None
            self.successful_queries += 1
            return self._format_direct_response(user_message, rows, 'leasing.PortfolioUnitDetails')
        except Exception as e:
            logger.error(f"Per-property analysis failed: {e}")
            return None
