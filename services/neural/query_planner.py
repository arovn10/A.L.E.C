"""
A.L.E.C. Query Planner — intercepts questions and fetches real data before LLM responds.

This is what makes A.L.E.C. actually intelligent instead of a generic chatbot.
When a user asks about properties, deals, occupancy, NOI, etc., the query planner:
1. Detects the intent
2. Generates and runs the SQL query against the Stoa database
3. Injects the real results into the LLM context
4. The LLM then responds with ACTUAL DATA, not hallucinated garbage
"""

import logging
import re
from typing import Optional

logger = logging.getLogger("alec.query_planner")

# Keywords that indicate the user wants Stoa data
STOA_KEYWORDS = [
    "property", "properties", "occupancy", "noi", "net operating income",
    "cap rate", "rent", "rental", "lease", "leasing", "tenant", "tenants",
    "deal", "deals", "loan", "loans", "bank", "banks", "mortgage",
    "t12", "financial", "revenue", "income", "expense", "expenses",
    "unit", "units", "bed", "beds", "bedroom", "bedrooms",
    "vacancy", "vacant", "occupied", "occupancy rate",
    "stoa", "campus rentals", "portfolio",
    "market", "highest", "lowest", "best", "worst", "top", "bottom",
    "performing", "performance", "average", "total", "sum",
    "address", "location", "city", "state",
    "contract", "contracts", "vendor", "vendors",
    "maintenance", "repair", "capex",
]

# Common Stoa queries mapped to SQL
QUERY_TEMPLATES = {
    "occupancy": {
        "detect": ["occupancy", "occupied", "vacancy", "vacant"],
        "sql": """
            SELECT TOP 20 
                p.PropertyName, p.City, p.State,
                p.TotalUnits, p.OccupiedUnits,
                CAST(ROUND(CAST(p.OccupiedUnits AS FLOAT) / NULLIF(p.TotalUnits, 0) * 100, 1) AS VARCHAR) + '%' as OccupancyRate
            FROM dbo.Properties p
            WHERE p.TotalUnits > 0
            ORDER BY CAST(p.OccupiedUnits AS FLOAT) / NULLIF(p.TotalUnits, 0) DESC
        """,
        "fallback_sql": """
            SELECT TOP 20 *
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE COLUMN_NAME LIKE '%occup%' OR COLUMN_NAME LIKE '%unit%' OR COLUMN_NAME LIKE '%vacant%'
        """,
    },
    "noi": {
        "detect": ["noi", "net operating income", "income", "revenue", "expense"],
        "sql": """
            SELECT TOP 20 
                p.PropertyName, p.City, p.State,
                p.GrossRevenue, p.OperatingExpenses,
                p.GrossRevenue - p.OperatingExpenses as NOI
            FROM dbo.Properties p
            WHERE p.GrossRevenue IS NOT NULL AND p.GrossRevenue > 0
            ORDER BY p.GrossRevenue - p.OperatingExpenses DESC
        """,
        "fallback_sql": """
            SELECT TOP 20 *
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE COLUMN_NAME LIKE '%revenue%' OR COLUMN_NAME LIKE '%income%' OR COLUMN_NAME LIKE '%NOI%' OR COLUMN_NAME LIKE '%expense%'
        """,
    },
    "properties": {
        "detect": ["property", "properties", "portfolio", "all properties"],
        "sql": """
            SELECT TOP 30 *
            FROM dbo.Properties
            ORDER BY PropertyName
        """,
        "fallback_sql": """
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME LIKE '%propert%' OR TABLE_NAME LIKE '%Property%'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """,
    },
    "deals": {
        "detect": ["deal", "deals", "acquisition", "transaction"],
        "sql": """
            SELECT TOP 20 *
            FROM dbo.Deals
            ORDER BY DealDate DESC
        """,
        "fallback_sql": """
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME LIKE '%deal%' OR TABLE_NAME LIKE '%Deal%'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """,
    },
    "loans": {
        "detect": ["loan", "loans", "mortgage", "debt", "bank", "lender"],
        "sql": """
            SELECT TOP 20 *
            FROM dbo.Loans
            ORDER BY LoanAmount DESC
        """,
        "fallback_sql": """
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME LIKE '%loan%' OR TABLE_NAME LIKE '%bank%' OR TABLE_NAME LIKE '%debt%'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """,
    },
    "leasing": {
        "detect": ["lease", "leasing", "tenant", "rent", "rental"],
        "sql": """
            SELECT TOP 20 *
            FROM dbo.Leasing
            ORDER BY LeaseStart DESC
        """,
        "fallback_sql": """
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME LIKE '%leas%' OR TABLE_NAME LIKE '%tenant%' OR TABLE_NAME LIKE '%rent%'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """,
    },
    "schema_discovery": {
        "detect": ["tables", "schema", "database structure", "what tables", "columns"],
        "sql": """
            SELECT TABLE_SCHEMA + '.' + TABLE_NAME as TableName, 
                   COUNT(*) as ColumnCount
            FROM INFORMATION_SCHEMA.COLUMNS
            GROUP BY TABLE_SCHEMA, TABLE_NAME
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        """,
    },
}


class QueryPlanner:
    """Detects data questions and fetches real results from Stoa DB."""

    def __init__(self, stoa):
        self.stoa = stoa
        self.query_count = 0
        self.successful_queries = 0

    def should_query_stoa(self, user_message: str) -> bool:
        """Check if this message is asking about Stoa data."""
        lower = user_message.lower()
        return any(kw in lower for kw in STOA_KEYWORDS)

    def get_data_context(self, user_message: str) -> Optional[str]:
        """
        If the user is asking about Stoa data, query the DB and return
        a context string with real results to inject into the LLM prompt.
        """
        if not self.stoa or not self.stoa.connected:
            # Try to connect
            if self.stoa:
                self.stoa.connect()
            if not self.stoa or not self.stoa.connected:
                return None

        if not self.should_query_stoa(user_message):
            return None

        lower = user_message.lower()
        self.query_count += 1

        # Find matching query template
        results = None
        query_type = None

        for qtype, template in QUERY_TEMPLATES.items():
            if any(kw in lower for kw in template["detect"]):
                query_type = qtype
                try:
                    results = self.stoa.query(template["sql"])
                    if not results and "fallback_sql" in template:
                        # Table/column names might be different — discover schema
                        results = self.stoa.query(template["fallback_sql"])
                        if results:
                            query_type = f"{qtype}_schema_discovery"
                except Exception as e:
                    logger.warning(f"Stoa query failed for {qtype}: {e}")
                    # Try fallback
                    try:
                        if "fallback_sql" in template:
                            results = self.stoa.query(template["fallback_sql"])
                            if results:
                                query_type = f"{qtype}_schema_discovery"
                    except Exception:
                        pass
                break

        # If no template matched, try a general table discovery
        if results is None:
            try:
                # Find relevant tables based on keywords
                tables = self.stoa.discover_tables()
                relevant = [t for t in tables if any(kw in t.lower() for kw in lower.split())]
                if relevant:
                    # Sample from the first relevant table
                    results = self.stoa.get_table_sample(relevant[0], limit=10)
                    query_type = f"sample_from_{relevant[0]}"
            except Exception as e:
                logger.warning(f"General Stoa lookup failed: {e}")

        if not results:
            return None

        self.successful_queries += 1

        # Format results as context
        context_parts = [
            f"[STOA DATABASE RESULTS — query type: {query_type}, rows: {len(results)}]",
            "Use this REAL DATA to answer the user's question. Do NOT make up data.",
            "If the data doesn't fully answer the question, say what you found and suggest a follow-up query.",
            "",
        ]

        # Format as a readable table
        if results:
            # Get column headers
            cols = list(results[0].keys())
            context_parts.append("| " + " | ".join(str(c) for c in cols) + " |")
            context_parts.append("| " + " | ".join("---" for _ in cols) + " |")
            for row in results[:20]:  # Limit to 20 rows in context
                vals = [str(row.get(c, "")) for c in cols]
                # Truncate long values
                vals = [v[:50] if len(v) > 50 else v for v in vals]
                context_parts.append("| " + " | ".join(vals) + " |")

        return "\n".join(context_parts)

    def get_stats(self) -> dict:
        return {
            "queries_attempted": self.query_count,
            "successful_queries": self.successful_queries,
            "stoa_connected": self.stoa.connected if self.stoa else False,
        }
