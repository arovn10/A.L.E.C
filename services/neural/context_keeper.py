"""
A.L.E.C. Context Keeper — Self-Maintaining Context Documents.

Rules:
1. After every significant data query, update the relevant context MD file
2. Track insights, trends, and anomalies discovered from Stoa data
3. Maintain a portfolio overview that stays current
4. Log what was learned and when, so A.L.E.C. builds institutional knowledge
5. Context files are the "memory" that persists across restarts
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.context_keeper")

CONTEXT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "context"


class ContextKeeper:
    """Maintains markdown context files that A.L.E.C. uses to remember
    what it has learned about the portfolio, properties, and data patterns.

    Context files are organized by topic:
    - portfolio_overview.md: High-level portfolio stats
    - property_insights.md: Per-property observations
    - trends.md: Month-over-month trends and patterns
    - costs.md: Cost analysis and budget observations
    - anomalies.md: Outliers and unusual data points
    - learning_log.md: What A.L.E.C. learned and when
    """

    CONTEXT_FILES = {
        "portfolio_overview": "portfolio_overview.md",
        "property_insights": "property_insights.md",
        "trends": "trends.md",
        "costs": "costs.md",
        "anomalies": "anomalies.md",
        "learning_log": "learning_log.md",
    }

    def __init__(self):
        CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
        self._ensure_files_exist()

    def _ensure_files_exist(self):
        """Create context files if they don't exist."""
        templates = {
            "portfolio_overview": "# Portfolio Overview\n\n_Auto-maintained by A.L.E.C._\n\n## Properties\n\n_No data yet._\n",
            "property_insights": "# Property Insights\n\n_Auto-maintained by A.L.E.C._\n\n_No insights yet._\n",
            "trends": "# Trends & Patterns\n\n_Auto-maintained by A.L.E.C._\n\n_No trends tracked yet._\n",
            "costs": "# Cost Analysis\n\n_Auto-maintained by A.L.E.C._\n\n_No cost data yet._\n",
            "anomalies": "# Anomalies & Outliers\n\n_Auto-maintained by A.L.E.C._\n\n_No anomalies detected yet._\n",
            "learning_log": "# Learning Log\n\n_A.L.E.C. records what it learns here._\n\n",
        }
        for key, filename in self.CONTEXT_FILES.items():
            path = CONTEXT_DIR / filename
            if not path.exists():
                path.write_text(templates.get(key, f"# {key}\n"))
                logger.info(f"Created context file: {filename}")

    def read_context(self, topic: str) -> str:
        """Read a context file by topic name."""
        filename = self.CONTEXT_FILES.get(topic)
        if not filename:
            return ""
        path = CONTEXT_DIR / filename
        if path.exists():
            return path.read_text()
        return ""

    def update_context(self, topic: str, content: str):
        """Overwrite a context file with new content."""
        filename = self.CONTEXT_FILES.get(topic)
        if not filename:
            logger.warning(f"Unknown context topic: {topic}")
            return
        path = CONTEXT_DIR / filename
        path.write_text(content)
        logger.info(f"Updated context: {filename}")

    def append_to_context(self, topic: str, entry: str):
        """Append an entry to a context file."""
        filename = self.CONTEXT_FILES.get(topic)
        if not filename:
            return
        path = CONTEXT_DIR / filename
        current = path.read_text() if path.exists() else ""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        new_entry = f"\n### {timestamp}\n{entry}\n"
        path.write_text(current + new_entry)

    def log_learning(self, category: str, what_learned: str, source: str = ""):
        """Record something A.L.E.C. learned in the learning log."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        entry = f"\n- **{timestamp}** [{category}]: {what_learned}"
        if source:
            entry += f" _(source: {source})_"
        entry += "\n"

        path = CONTEXT_DIR / self.CONTEXT_FILES["learning_log"]
        current = path.read_text() if path.exists() else "# Learning Log\n\n"
        path.write_text(current + entry)

    def update_portfolio_overview(self, properties: list[dict]):
        """Update the portfolio overview with latest property data."""
        lines = ["# Portfolio Overview\n"]
        lines.append(f"_Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M')}_\n")
        lines.append(f"## Properties ({len(properties)} total)\n")

        for prop in properties:
            name = prop.get('PropertyName', prop.get('name', 'Unknown'))
            occ = prop.get('OccupancyPct')
            rent = prop.get('AvgLeasedRent')
            units = prop.get('TotalUnits')

            line = f"### {name}\n"
            if occ is not None:
                line += f"- Occupancy: {occ:.1f}%\n"
            if rent is not None:
                line += f"- Avg Rent: ${rent:,.2f}\n"
            if units is not None:
                line += f"- Total Units: {units}\n"
            lines.append(line)

        self.update_context("portfolio_overview", "\n".join(lines))
        self.log_learning("portfolio", f"Updated portfolio overview with {len(properties)} properties")

    def record_insight(self, insight: str, property_name: str = "", metric: str = ""):
        """Record a data insight."""
        entry = f"**{property_name}** " if property_name else ""
        entry += f"({metric}) " if metric else ""
        entry += insight
        self.append_to_context("property_insights", entry)
        self.log_learning("insight", insight, property_name)

    def record_trend(self, trend_description: str, metric: str = "", direction: str = ""):
        """Record a trend observation."""
        emoji = ""
        if direction == "up":
            emoji = "Trending up: "
        elif direction == "down":
            emoji = "Trending down: "
        entry = f"{emoji}{trend_description}"
        if metric:
            entry += f" (metric: {metric})"
        self.append_to_context("trends", entry)
        self.log_learning("trend", trend_description)

    def record_anomaly(self, anomaly: str, severity: str = "info"):
        """Record an anomaly or outlier."""
        severity_label = {"info": "Info", "warning": "Warning", "critical": "Critical"}
        label = severity_label.get(severity, "Info")
        entry = f"**[{label}]** {anomaly}"
        self.append_to_context("anomalies", entry)
        self.log_learning("anomaly", anomaly)

    def record_cost_observation(self, observation: str):
        """Record a cost-related observation."""
        self.append_to_context("costs", observation)
        self.log_learning("cost", observation)

    def get_all_context(self) -> str:
        """Get all context files combined for injection into prompts."""
        parts = []
        for topic, filename in self.CONTEXT_FILES.items():
            content = self.read_context(topic)
            if content and "_No " not in content[:100]:
                parts.append(content)
        return "\n---\n".join(parts) if parts else ""

    def get_context_summary(self) -> dict:
        """Get a summary of context file sizes and last modified times."""
        summary = {}
        for topic, filename in self.CONTEXT_FILES.items():
            path = CONTEXT_DIR / filename
            if path.exists():
                stat = path.stat()
                summary[topic] = {
                    "size_bytes": stat.st_size,
                    "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "lines": len(path.read_text().splitlines()),
                }
        return summary
