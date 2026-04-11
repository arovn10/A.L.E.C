"""
A.L.E.C. Knowledge Service — Unified truth arbitration layer.

This is the SINGLE source of truth for all answer composition.
Every answer path queries this service first, which returns a structured
evidence bundle with source type, confidence, and whether the answer
can be composed directly without LLM involvement.

Precedence rules (highest to lowest):
1. CORRECTION — owner corrected A.L.E.C., always wins
2. DATABASE — direct Stoa query result (structured data)
3. MEMORY_FACT — owner-taught fact with high confidence
4. MEMORY_PREFERENCE — owner preference
5. MODEL_PRIOR — let the LLM answer (lowest trust)

Usage:
    ks = KnowledgeService(memory, query_planner)
    evidence = ks.gather_evidence("What is the occupancy at Heights at Picardy?")
    if evidence.can_compose_directly:
        return evidence.composed_answer
    else:
        # Fall through to LLM with evidence.context_injection
"""
import logging
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, timezone

logger = logging.getLogger("alec.knowledge")


@dataclass
class EvidenceItem:
    """A single piece of evidence from any source."""
    source_type: str  # correction, database, memory_fact, memory_preference, memory_person, memory_property
    content: str
    confidence: float  # 0.0 to 1.0
    source_detail: str = ""  # e.g. "memory:id=42" or "stoa:vw_PropertyMetrics"
    timestamp: str = ""
    category: str = ""

    @property
    def priority(self) -> int:
        """Lower number = higher priority."""
        priorities = {
            "correction": 1,
            "database": 2,
            "memory_fact": 3,
            "memory_person": 3,
            "memory_company": 3,
            "memory_property": 4,
            "memory_preference": 5,
            "model_prior": 10,
        }
        return priorities.get(self.source_type, 9)


@dataclass
class EvidenceBundle:
    """Structured evidence gathered for a query."""
    query: str
    items: list = field(default_factory=list)
    can_compose_directly: bool = False
    composed_answer: str = ""
    context_injection: str = ""
    abstain: bool = False
    abstain_reason: str = ""
    source_model: str = ""  # For logging: which model/path answered

    @property
    def has_evidence(self) -> bool:
        return len(self.items) > 0

    @property
    def top_source(self) -> str:
        if not self.items:
            return "none"
        return min(self.items, key=lambda x: x.priority).source_type

    @property
    def max_confidence(self) -> float:
        if not self.items:
            return 0.0
        return max(i.confidence for i in self.items)


class KnowledgeService:
    """
    Unified truth arbitration layer for A.L.E.C.
    
    Gathers evidence from all sources (memory, database, corrections),
    applies precedence rules, and decides whether to compose directly
    or defer to the LLM.
    """

    def __init__(self, memory, query_planner):
        self.memory = memory
        self.query_planner = query_planner
        self._query_count = 0
        self._direct_count = 0
        self._abstain_count = 0
        self._llm_fallback_count = 0

    def gather_evidence(self, user_message: str) -> EvidenceBundle:
        """
        Main entry point. Gathers all available evidence for a query
        and decides the best answer strategy.
        """
        self._query_count += 1
        bundle = EvidenceBundle(query=user_message)

        # 1. Check corrections first (always highest priority)
        self._gather_corrections(user_message, bundle)

        # 2. Check database (Stoa direct response)
        self._gather_database_evidence(user_message, bundle)

        # 3. Check memory (facts, people, preferences, properties)
        self._gather_memory_evidence(user_message, bundle)

        # 4. Apply decision logic
        self._decide_strategy(user_message, bundle)

        return bundle

    def _gather_corrections(self, query: str, bundle: EvidenceBundle):
        """Check if any corrections apply to this query."""
        try:
            corrections = self.memory.recall_by_category("correction", limit=20)
            for c in corrections:
                value_lower = c.get("value", "").lower()
                query_lower = query.lower()
                # Check if correction is relevant to this query
                # Extract key terms from the query and match against correction
                query_words = set(query_lower.split())
                correction_words = set(value_lower.split())
                overlap = query_words & correction_words
                # If significant overlap, this correction is relevant
                if len(overlap) >= 2 or any(w in value_lower for w in query_lower.split() if len(w) > 3):
                    bundle.items.append(EvidenceItem(
                        source_type="correction",
                        content=c["value"],
                        confidence=1.0,
                        source_detail=f"memory:id={c.get('id', '?')}",
                        timestamp=c.get("updated_at", ""),
                        category="correction",
                    ))
        except Exception as e:
            logger.warning(f"Correction lookup failed: {e}")

    def _gather_database_evidence(self, query: str, bundle: EvidenceBundle):
        """Check Stoa database for direct data answers."""
        try:
            if not self.query_planner or not self.query_planner.stoa:
                return
            if not self.query_planner.stoa.connected:
                return

            # Check if this is a data query
            is_data = self.query_planner.should_query_stoa(query)
            if not is_data:
                return

            # Try direct response
            direct = self.query_planner.get_direct_response(query)
            if direct:
                bundle.items.append(EvidenceItem(
                    source_type="database",
                    content=direct,
                    confidence=1.0,
                    source_detail="stoa:direct_response",
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    category="data",
                ))
        except Exception as e:
            logger.warning(f"Database evidence gathering failed: {e}")

    def _gather_memory_evidence(self, query: str, bundle: EvidenceBundle):
        """Search persistent memory for relevant facts."""
        try:
            memories = self.memory.recall(query, limit=10)
            for m in memories:
                cat = m.get("category", "fact")
                if cat == "correction":
                    continue  # Already handled
                source_type = f"memory_{cat}"
                bundle.items.append(EvidenceItem(
                    source_type=source_type,
                    content=m["value"],
                    confidence=m.get("confidence", 0.8),
                    source_detail=f"memory:id={m.get('id', '?')}",
                    timestamp=m.get("updated_at", ""),
                    category=cat,
                ))
        except Exception as e:
            logger.warning(f"Memory evidence gathering failed: {e}")

    def _decide_strategy(self, query: str, bundle: EvidenceBundle):
        """
        Apply precedence rules to decide answer strategy.
        
        Rules:
        - If database evidence exists with high confidence -> compose directly
        - If correction exists that directly answers -> compose directly  
        - If memory fact exists with high confidence -> compose directly
        - If data query but no evidence -> ABSTAIN (don't let LLM hallucinate)
        - Otherwise -> inject context and let LLM answer
        """
        if not bundle.items:
            # No evidence at all
            is_data_query = False
            try:
                is_data_query = self.query_planner.should_query_stoa(query) if self.query_planner else False
            except Exception:
                pass

            if is_data_query:
                # Data query with no evidence = ABSTAIN
                bundle.abstain = True
                bundle.abstain_reason = "data_query_no_evidence"
                self._abstain_count += 1
                
                # Build abstain message
                try:
                    matched = self.query_planner._match_property(query)
                    if matched:
                        bundle.composed_answer = (
                            f"I found **{matched[0]}** in our portfolio, but I couldn't pull "
                            f"that specific metric right now. Would you like me to try a "
                            f"different angle or search the web for more info?"
                        )
                    else:
                        prop_count = len(getattr(self.query_planner, 'known_properties', []))
                        bundle.composed_answer = (
                            f"I don't have any data for that in my database. "
                            f"Our portfolio currently tracks {prop_count} properties "
                            f"under the Stoa Group. Would you like me to search the web "
                            f"for information on that instead?"
                        )
                except Exception:
                    bundle.composed_answer = (
                        "I don't have that data in my database right now. "
                        "Would you like me to search the web for information on that instead?"
                    )
                bundle.can_compose_directly = True
                bundle.source_model = "alec-v2+anti-hallucination"
            else:
                # General question, no evidence — let LLM handle
                self._llm_fallback_count += 1
            return

        # Sort by priority
        bundle.items.sort(key=lambda x: x.priority)
        top = bundle.items[0]

        # Database direct response -> always compose directly
        if top.source_type == "database":
            bundle.can_compose_directly = True
            bundle.composed_answer = top.content
            bundle.source_model = "alec-v2+stoa-direct"
            self._direct_count += 1
            return

        # Correction that directly answers -> compose directly
        if top.source_type == "correction" and top.confidence >= 0.9:
            bundle.can_compose_directly = True
            bundle.composed_answer = self._compose_from_correction(top, query)
            bundle.source_model = "alec-v2+correction-direct"
            self._direct_count += 1
            return

        # High-confidence memory fact -> compose directly
        if top.source_type in ("memory_fact", "memory_person", "memory_company", "memory_property") and top.confidence >= 0.9:
            bundle.can_compose_directly = True
            bundle.composed_answer = self._compose_from_memory(top, query)
            bundle.source_model = "alec-v2+memory-direct"
            self._direct_count += 1
            return

        # Otherwise: build context injection for LLM
        bundle.context_injection = self._build_context_injection(bundle)
        self._llm_fallback_count += 1

    def _compose_from_correction(self, item: EvidenceItem, query: str) -> str:
        """Build a direct response from a correction."""
        value = item.content
        # Extract the CORRECT part from "WRONG: ... CORRECT: ..."
        if "CORRECT:" in value:
            correct_part = value.split("CORRECT:")[-1].strip()
            return correct_part
        return value

    def _compose_from_memory(self, item: EvidenceItem, query: str) -> str:
        """Build a direct response from a memory fact."""
        return item.content

    def _build_context_injection(self, bundle: EvidenceBundle) -> str:
        """Build context string for LLM injection from evidence."""
        parts = []
        corrections = [i for i in bundle.items if i.source_type == "correction"]
        facts = [i for i in bundle.items if i.source_type != "correction"]

        if corrections:
            parts.append("## CORRECTIONS (you were corrected on these — ALWAYS follow):")
            for c in corrections:
                parts.append(f"- {c.content}")

        if facts:
            parts.append("\n## KNOWN FACTS (use these to answer):")
            for f in facts:
                parts.append(f"- [{f.category}] {f.content}")

        return "\n".join(parts)

    def get_stats(self) -> dict:
        """Return service statistics."""
        return {
            "total_queries": self._query_count,
            "direct_compositions": self._direct_count,
            "abstentions": self._abstain_count,
            "llm_fallbacks": self._llm_fallback_count,
            "direct_rate": round(self._direct_count / max(self._query_count, 1), 3),
            "abstain_rate": round(self._abstain_count / max(self._query_count, 1), 3),
        }
