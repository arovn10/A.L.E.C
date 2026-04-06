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

            # PRIORITY TABLES: DailyPropertyMetrics is the main property dashboard table.
            # It has OccupancyPct, AvgLeasedRent, TotalUnits, Velocity, etc.
            # Always prefer it for property-level questions.
            priority_tables = {
                "leasing.dailypropertymetrics": 25,   # Main property dashboard
                "leasing.propertylist": 10,            # Property directory
                "leasing.portfoliounitdetails": 8,     # Unit-level detail
                "core.project": 8,                     # Project/deal info
                "banking.loan": 5,                     # Loan data
                "contracts.contract": 5,               # Contract data
            }
            bonus = priority_tables.get(table_lower, 0)
            if bonus and score > 0:
                score += bonus

            if score > 0:
                scored.append((table, score))

        scored.sort(key=lambda x: -x[1])
        return scored[:5]  # Top 5 most relevant


        def _match_property_in_message(self, user_message: str) -> list[str]:
        """Match property names from user message against actual DB data.
        This is much more reliable than regex extraction for names like
        'Heights at Picardy' which contain lowercase connectors."""
    lower = user_message.lower()
        # Get known property names from cache or DB
        if not hasattr(self, '_property_names'):
            self._property_names = []
            if self.stoa and self.stoa.connected:
                try:
                    for table in self.schema:
                        cols = self.schema[table]
                        name_cols = [c for c in cols if any(kw in c.lower() for kw in ['name', 'property', 'title'])]
                        if name_cols:
                            sql = f"SELECT DISTINCT [{name_cols[0]}] FROM [{table.split('.')[0]}].[{table.split('.')[1] if '.' in table else table}] WHERE [{name_cols[0]}] IS NOT NULL"
                            try:
                                rows = self.stoa.query(sql)
                                for r in rows:
                                    val = r.get(name_cols[0], '')
                                    if val and len(str(val)) > 2:
                                        self._property_names.append(str(val))
                            except Exception:
                                pass
                except Exception:
                    pass
            self._property_names = list(set(self._property_names))
            logger.info(f"Cached {len(self._property_names)} property names from DB")
        # Match against known names
        matched = []
        for name in self._property_names:
            if name.lower() in lower:
                matched.append(name)
        # Also try partial matching: if user says "picardy" match "The Heights at Picardy"
        if not matched:
            words = set(re.findall(r'[a-z]{4,}', lower))
            # Remove generic words
            words -= {'what', 'which', 'where', 'when', 'that', 'this', 'from', 'have', 'does',
                      'show', 'tell', 'give', 'about', 'occupancy', 'rent', 'units', 'data',
                      'property', 'properties', 'highest', 'lowest', 'total', 'average', 'list',
                      'database', 'stoa', 'many', 'much'}
            for name in self._property_names:
                name_words = set(re.findall(r'[a-z]{4,}', name.lower()))
                if words & name_words:
                    matched.append(name)
        return matched
    def _generate_sql(self, table: str, user_message: str) -> str:
        """Generate a SQL query for a table based on the user's question."""
        columns = self.schema.get(table, [])
        lower = user_message.lower()

                # Extract requested count from user message (e.g., "top 5" -> 5)
        count_match = re.search(r'(?:top|bottom|first|last)\s+(\d+)', lower)
        row_limit = int(count_match.group(1)) if count_match else 15

        # Detect if asking about a specific entity
        # Look for property names, places, etc.
        name_cols = [c for c in columns if any(kw in c.lower() for kw in ["name", "title", "description", "property", "project"])]
        
        # Build WHERE clause for specific lookups
        where_parts = []
        # Extract potential entity names (capitalized words, quoted strings)
        quoted = re.findall(r'"([^"]+)"', user_message)
        named = re.findall(r'(?:the |at |about |for )([A-Z][a-z]+(?: [A-Za-z]+)*)', user_message)
                # Also try matching against actual DB property names (handles 'Heights at Picardy' etc)
        db_matched = self._match_property_in_message(user_message)
        if db_matched:
            search_terms = db_matched  # DB names are more reliable than regex
        else:
            search_terms = quoted + named
        
        # DO NOT hardcode property names — let the regex extraction above
        # handle specific entities from quoted strings and capitalized words.
        # Hardcoded names caused the query planner to fixate on one property
        # (e.g. Bluebonnet) even when users asked for "all properties".
        generic_terms = {"stoa", "data", "database", "property", "properties", "all", "every", "list", "show"}
        # Filter out generic terms that aren't actual property names
        search_terms = [t for t in search_terms if t.lower() not in generic_terms]
        if search_terms and name_cols:
            for col in name_cols[:2]:
                for term in search_terms:
                    where_parts.append(f"[{col}] LIKE '%{term}%'")

        # Detect ordering intent
        order = ""
        if any(w in lower for w in ["highest", "top", "best", "most", "maximum", "max"]):
            # Find numeric columns to sort by — prioritize columns that match the user's question
            user_words = set(re.findall(r'[a-z]{3,}', lower))
            # First try to find a column matching what the user asked about
            num_cols = [c for c in columns if any(uw in c.lower() for uw in user_words if uw not in generic_terms)]
            # Filter to likely numeric columns
            num_cols = [c for c in num_cols if any(kw in c.lower() for kw in ["rate", "pct", "occupancy", "total", "amount", "count", "revenue", "income", "price", "rent", "units", "avg", "velocity", "delta", "budget", "variance"])]
            # Fallback to any numeric-looking column
            if not num_cols:
                num_cols = [c for c in columns if any(kw in c.lower() for kw in ["rate", "pct", "occupancy", "total", "amount", "count", "revenue", "income", "price", "rent"])]
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

        # For time-series tables (have ReportDate/Date column), default to latest data
        date_cols_available = [c for c in columns if c.lower() in ("reportdate", "date", "created_at", "createdat", "computedat")]
        if date_cols_available:
            # Get latest date's data unless user asked about a specific time
            time_words = {"history", "trend", "over time", "last year", "monthly", "weekly", "daily", "all time"}
            if not any(tw in lower for tw in time_words):
                dcol = date_cols_available[0]
                where_parts.append(f"[{dcol}] = (SELECT MAX([{dcol}]) FROM [{table.split('.')[0]}].[{table.split('.')[1] if '.' in table else table}])")

        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        schema_name = table.split('.')[0]
        table_name = table.split('.')[1] if '.' in table else table
        
        return f"SELECT TOP {row_limit} * FROM [{schema_name}].[{table_name}] {where_clause} {order}"

    def should_query_stoa(self, user_message: str) -> bool:
        """Check if this message warrants a database query.
        Must distinguish data questions from memory/preference/command statements."""
        lower = user_message.lower()

        # NOT a data query if it's a memory/preference/command statement
        non_data_patterns = [
            "remember ", "forget ", "my favorite", "i prefer", "i like",
            "i want you to", "change ", "update ", "make ",
            "turn on", "turn off", "set ", "schedule ", "remind ",
            "who are you", "what can you", "help me", "hello", "hey alec",
            "thank", "thanks", "good job", "nice", "great",
            "can you see", "do you have access", "are you able",
            "search the web", "search the internet", "google ", "look up",
            "browse ", "latest news", "find out", "what is the weather",
            "stock price", "current events", "today's news",
            "qwen", "llama", "model release", "ai news",
            "turn on", "turn off", "lights", "brightness",
            "email ", "send me", "send a report",
            "improve yourself", "your code", "edit ",
            # Self-repair / self-edit requests — NOT data queries
            "fix yourself", "fix your", "repair yourself", "repair your",
            "improve your", "self_edit", "trigger a self",
            "commit", "push", "deploy",
        ]
        if any(pat in lower for pat in non_data_patterns):
            return False

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

        
        return self._format_results(all_results)

    def _format_results(self, all_results: list[dict]) -> str:
        """Format query results as a pre-written answer the LLM can relay directly.
        
        Small models (7B) can't reliably parse markdown tables and extract answers.
        Instead, we format the data as a ready-to-use narrative so the model just
        needs to pass it through with minimal interpretation.
        """
        parts = []
        parts.append("[STOA DATABASE QUERY RESULTS — THIS IS REAL DATA. Read it back to the user EXACTLY as shown. Do NOT substitute placeholders or make up values.]")
        parts.append("")

        for result in all_results:
            rows = result.get("rows", [])
            if not rows:
                continue
            rtype = result.get("type", "data")
            parts.append(f"Source table: {rtype} — {len(rows)} rows returned.")
            parts.append("")

            # Format each row as key: value pairs (much easier for small models)
            for i, row in enumerate(rows[:10]):
                parts.append(f"Row {i+1}:")
                for col, val in row.items():
                    if val is not None and str(val).strip():
                        clean = str(val).strip()
                        if len(clean) > 80:
                            clean = clean[:80] + "…"
                        parts.append(f"  {col}: {clean}")
                parts.append("")

            # Also provide a one-line summary per row for quick reference
            parts.append("SUMMARY (use this to answer the user):")
            for i, row in enumerate(rows[:10]):
                # Pick the most meaningful columns for a summary line
                summary_parts = []
                for col, val in row.items():
                    if val is not None and str(val).strip():
                        clow = col.lower()
                        # Prioritize name/property/description and numeric fields
                        if any(kw in clow for kw in ["name", "property", "project", "title", "description",
                                                      "rate", "pct", "occupancy", "rent", "total", "amount",
                                                      "units", "count", "price", "noi", "revenue"]):
                            summary_parts.append(f"{col}={val}")
                if summary_parts:
                    parts.append(f"  {i+1}. {', '.join(summary_parts[:8])}")
            parts.append("")

        parts.append("[END OF DATABASE RESULTS. Present the above data naturally. Say 'From the Stoa database:' then give the facts.]")
        return "\n".join(parts)

    def get_direct_response(self, user_message: str) -> Optional[str]:
        """Query the Stoa DB and return a formatted human-readable response.
        
        This BYPASSES the LLM entirely. The 7B model can't reliably use
        injected data — it hallucinates fake values. Instead, we format
        the query results directly into natural language.
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

        # Skip cache for ranking/list queries — cached queries are often
        # filtered to a single property and won't work for "top 5" etc.
        is_ranking = any(kw in user_message.lower() for kw in [
            'top ', 'bottom ', 'best ', 'worst ', 'highest ', 'lowest ',
            'all properties', 'all ', 'every ', 'list ', 'show me', 'rank',
        ])

        # Check cache
        cache_key = re.sub(r'[^a-z ]+', '', user_message.lower()).strip()[:50]
        cached_rows = None

        # Try specialized handlers first
        trend_result = self.get_trend_response(user_message)
        if trend_result:
            return trend_result

        cost_result = self.get_cost_analysis(user_message)
        if cost_result:
            return cost_result
        if cache_key in self.query_cache and not is_ranking:
            try:
                cached_rows = self.stoa.query(self.query_cache[cache_key])
            except Exception:
                del self.query_cache[cache_key]
        # Find relevant tables and query
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
                    # Try without WHERE
                    schema_name = table.split('.')[0]
                    table_name = table.split('.')[1] if '.' in table else table
                    simple_sql = f"SELECT TOP 10 * FROM [{schema_name}].[{table_name}] ORDER BY 1 DESC"
                    rows = self.stoa.query(simple_sql)
                    if rows:
                        source_table = table
                        sql_used = simple_sql
                        self.query_cache[cache_key] = simple_sql
                        self._save_cache()
                        break
                except Exception as e:
                    logger.info(f"  Failed: {e}")

        if not rows:

                        return None
                    # Ranking queries: if we got too few rows, retry without date filter
        # This happens when only some properties have data for the latest date
        if is_ranking and len(rows) <= 2 and source_table != "cached":
            logger.info(f"  Ranking query got only {len(rows)} rows — retrying without date filter")
            try:
                sn = source_table.split('.')[0]
                tn = source_table.split('.')[1] if '.' in source_table else source_table
                # Find the ordering column from the original SQL
                order_col = None
                lower = user_message.lower()
                metric_map = {
                    'occupancy': 'OccupancyPct', 'rent': 'AvgLeasedRent',
                    'units': 'TotalUnits', 'velocity': 'Velocity28dNew',
                    'leased': 'LeasedPct', 'revenue': 'RevOSF',
                }
                for kw, col in metric_map.items():
                    if kw in lower and col in self.schema.get(source_table, []):
                        order_col = col
                        break
                order = f"ORDER BY [{order_col}] DESC" if order_col else "ORDER BY 1 DESC"
                retry_sql = f"SELECT TOP 15 * FROM [{sn}].[{tn}] {order}"
                retry_rows = self.stoa.query(retry_sql)
                if retry_rows and len(retry_rows) > len(rows):
                    rows = retry_rows
                    logger.info(f"  Retry got {len(rows)} rows")
            except Exception as e:
                logger.info(f"  Retry failed: {e}")
        
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
        """Format query results as a natural language response.
        
        KEY PRINCIPLE: if the user asked for a specific metric, return ONLY that
        metric. Don't dump the entire row. Short, concise answers.
        """
        lower = user_message.lower()
        cols = list(rows[0].keys()) if rows else []

        # Detect what the user is asking about to pick the right columns
        # Property name column
        name_col = next((c for c in cols if c.lower() in ('property', 'propertyname', 'property_name', 'name', 'projectname', 'project_name', 'title')), None)
        if not name_col:
            name_col = next((c for c in cols if 'name' in c.lower() or 'property' in c.lower()), None)

        # Figure out the metric they care about
        # "just X", "only X", "what is the X" all signal a specific metric request
        metric_col = None
        metric_label = "value"
        metric_map = {
            'occupancy': ('OccupancyPct', 'occupancy'),
            'occ ': ('OccupancyPct', 'occupancy'),
            'occupancy pct': ('OccupancyPct', 'occupancy'),
            'rent': ('AvgLeasedRent', 'average leased rent'),
            'average rent': ('AvgLeasedRent', 'average leased rent'),
            'avg rent': ('AvgLeasedRent', 'average leased rent'),
            'units': ('TotalUnits', 'total units'),
            'total units': ('TotalUnits', 'total units'),
            'vacancy': ('AvailableUnits', 'available units'),
            'available': ('AvailableUnits', 'available units'),
            'velocity': ('Velocity28dNew', '28-day lease velocity'),
            'leased': ('LeasedPct', 'leased percentage'),
            'leased pct': ('LeasedPct', 'leased percentage'),
            'budget': ('BudgetedOccupancy', 'budgeted occupancy'),
            'budgeted': ('BudgetedOccupancy', 'budgeted occupancy'),
            'revenue': ('RevOSF', 'revenue per occupied SF'),
            'noi': ('RevOSF', 'revenue per occupied SF'),
            'trade out': ('TradeOutPct', 'trade-out percentage'),
            'rent growth': ('RentGrowth3MoPct', '3-month rent growth'),
            'look ahead': ('OccupancyLookAhead4Weeks', '4-week occupancy look-ahead'),
        }
        for keyword, (col_name, label) in metric_map.items():
            if keyword in lower:
                if col_name in cols:
                    metric_col = col_name
                    metric_label = label
                    break

        # If no specific metric detected, try to find the most relevant numeric column
        if not metric_col:
            for c in cols:
                clow = c.lower()
                if any(kw in clow for kw in ['pct', 'rate', 'occupancy', 'rent', 'total', 'revenue', 'amount']):
                    metric_col = c
                    metric_label = c
                    break

        # Build the response
        parts = ["From the Stoa database:\n"]
        # Asking about a specific property?
        is_specific = len(rows) <= 3  # Few rows = specific property query (don't hardcode names)
        is_ranking = any(kw in lower for kw in ['top', 'best', 'highest', 'lowest', 'worst', 'bottom', 'all', 'list', 'show', 'every'])

        if is_specific:
            # If the user asked for a SPECIFIC metric, return ONLY that metric.
            # If they asked a general question, show the full detail view.
            for row in rows:
                pname = row.get(name_col, 'Unknown') if name_col else 'Unknown'

                if metric_col and metric_col in row:
                    # User asked for a specific metric — concise answer
                    val = row.get(metric_col)
                    display_val = self._format_value(val, metric_col)
                    parts.append(f"**{pname}** — {metric_label}: {display_val}")
                else:
                    # General question — show all fields
                    parts.append(f"**{pname}**")
                    for col, val in row.items():
                        if val is not None and str(val).strip() and col != name_col:
                            display_val = self._format_value(val, col)
                            col_display = re.sub(r'([A-Z])', r' \1', col).strip()
                            parts.append(f"  {col_display}: {display_val}")
                parts.append("")
        else:
            # Ranking / list view
            if metric_col:
                parts.append(f"Properties ranked by {metric_label}:\n")
                for i, row in enumerate(rows[:15]):
                    pname = row.get(name_col, f'Row {i+1}') if name_col else f'Row {i+1}'
                    val = row.get(metric_col)
                    if val is not None:
                        display = self._format_value(val, metric_col)
                        parts.append(f"{i+1}. **{pname}** — {metric_label}: {display}")
                    else:
                        parts.append(f"{i+1}. **{pname}**")
            else:
                # No clear metric — show key fields
                parts.append(f"Results ({len(rows)} rows from {source}):\n")
                for i, row in enumerate(rows[:10]):
                    pname = row.get(name_col, f'Row {i+1}') if name_col else f'Row {i+1}'
                    key_vals = []
                    for col, val in row.items():
                        if val is not None and col != name_col and str(val).strip():
                            key_vals.append(f"{col}: {val}")
                        if len(key_vals) >= 5:
                            break
                    parts.append(f"{i+1}. **{pname}** — {', '.join(key_vals)}")

        report_date = None
        for row in rows[:1]:
            for col in ['ReportDate', 'Date', 'CreatedAt']:
                if col in row and row[col]:
                    report_date = str(row[col])[:10]
                    break
        if report_date:
            parts.append(f"\n_Data as of {report_date}_")

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

    def _is_trend_query(self, user_message: str) -> bool:
        """Detect if the user is asking about trends or month-over-month data."""
        lower = user_message.lower()
        trend_keywords = [
            'trend', 'over time', 'month over month', 'month by month',
            'monthly', 'quarterly', 'yearly', 'year over year',
            'history', 'historical', 'compare months', 'last 3 months',
            'last 6 months', 'last 12 months', 'last year',
            'growth', 'decline', 'change', 'delta', 'progression',
            'improving', 'worsening', 'increasing', 'decreasing',
        ]
        return any(kw in lower for kw in trend_keywords)

    def _is_cost_query(self, user_message: str) -> bool:
        """Detect if the user is asking about costs or expenses."""
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
        """Generate SQL for month-over-month trend analysis."""
        columns = self.schema.get(table, [])
        lower = user_message.lower()

        date_col = None
        for c in columns:
            if c.lower() in ('reportdate', 'date', 'createdat', 'computedat'):
                date_col = c
                break
        if not date_col:
            return None

        metric_col = None
        metric_map = {
            'occupancy': 'OccupancyPct', 'rent': 'AvgLeasedRent',
            'revenue': 'RevOSF', 'noi': 'RevOSF',
            'velocity': 'Velocity28dNew', 'leased': 'LeasedPct',
            'vacancy': 'AvailableUnits', 'units': 'TotalUnits',
        }
        for keyword, col_name in metric_map.items():
            if keyword in lower and col_name in columns:
                metric_col = col_name
                break

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
        if metric_col:
            select_parts.append(f"AVG([{metric_col}]) as avg_{metric_col}")
            select_parts.append(f"MIN([{metric_col}]) as min_{metric_col}")
            select_parts.append(f"MAX([{metric_col}]) as max_{metric_col}")
        else:
            select_parts.append("COUNT(*) as record_count")

        group_parts = [f"FORMAT([{date_col}], 'yyyy-MM')"]
        if name_col:
            group_parts.append(f"[{name_col}]")

        sql = f"SELECT {', '.join(select_parts)} FROM [{schema_name}].[{table_name}] WHERE [{date_col}] >= DATEADD(month, -{months}, GETDATE()) GROUP BY {', '.join(group_parts)} ORDER BY Month DESC"
        return sql

    def get_trend_response(self, user_message: str) -> Optional[str]:
        """Handle trend/month-over-month queries."""
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
                    def get_direct_response
                    return self._format_trend_response(rows, table)
            except Exception as e:
                logger.info(f"  Trend query failed: {e}")
        return None

    def _format_trend_response(self, rows: list[dict], source: str) -> str:
        """Format trend data as month-by-month breakdown."""
        parts = ["From the Stoa database — **Trend Analysis**:\n"]
        months_data: dict[str, list[dict]] = {}
        for row in rows:
            month = row.get('Month', 'Unknown')
            if month not in months_data:
                months_data[month] = []
            months_data[month].append(row)

        metric_cols = [c for c in rows[0].keys() if c.startswith('avg_') or c.startswith('min_') or c.startswith('max_')]
        name_col = next((c for c in rows[0].keys() if 'name' in c.lower() or 'property' in c.lower()), None)

        for month in sorted(months_data.keys(), reverse=True):
            month_rows = months_data[month]
            parts.append(f"**{month}:**")
            for row in month_rows[:10]:
                label = row.get(name_col, '') if name_col else ''
                vals = []
                for mc in metric_cols:
                    if row.get(mc) is not None:
                        col_base = mc.split('_', 1)[1] if '_' in mc else mc
                        vals.append(f"{mc}: {self._format_value(row[mc], col_base)}")
                line = f"  {label}: {', '.join(vals)}" if label else f"  {', '.join(vals)}"
                parts.append(line)
            parts.append("")

        if len(months_data) >= 2:
            sm = sorted(months_data.keys())
            parts.append(f"**Insight:** Data spans {sm[0]} to {sm[-1]} ({len(months_data)} months).")
        return "\n".join(parts)

    def get_cost_analysis(self, user_message: str) -> Optional[str]:
        """Handle cost/expense analysis queries."""
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
        """Generate analytical insights — outliers and notable data points."""
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

        parts = ["From the Stoa database — **Key Insights**:\n"]
        for ins in insights:
            parts.append(f"- {ins}")
        parts.append(f"\n_Source: {table}_")
        self.successful_queries += 1
        return "\n".join(parts)
