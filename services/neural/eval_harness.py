"""
A.L.E.C. Evaluation Harness — Automated groundedness & quality testing.

Runs repeatable test suites across four categories:
1. Stoa groundedness (data queries return real data, not fabrications)
2. Memory recall (taught facts are correctly recalled)
3. Correction retention (corrected facts override old wrong answers)
4. Abstention behavior (unknown data triggers refusal, not hallucination)

Usage:
    harness = EvalHarness(knowledge_service, memory, engine)
    results = harness.run_all()
    print(results["summary"])
"""
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, Callable
from pathlib import Path

logger = logging.getLogger("alec.eval")

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


@dataclass
class TestCase:
    """A single evaluation test case."""
    id: str
    category: str  # groundedness, memory_recall, correction, abstention
    name: str
    description: str
    input_message: str
    expected_behavior: str  # "contains", "not_contains", "abstains", "direct_compose"
    expected_values: list = field(default_factory=list)  # strings that should/shouldn't appear
    forbidden_values: list = field(default_factory=list)  # strings that must NOT appear


@dataclass
class TestResult:
    """Result of running one test case."""
    test_id: str
    passed: bool
    confidence: float  # 0.0 to 1.0
    response: str
    evidence_source: str = ""
    failure_reason: str = ""
    latency_ms: float = 0.0


# ── Built-in test suite ─────────────────────────────────────────
DEFAULT_TESTS = [
    # === ABSTENTION TESTS ===
    TestCase(
        id="abstain_unknown_property",
        category="abstention",
        name="Unknown property abstention",
        description="Asking about a property not in the database should trigger abstention",
        input_message="What is the occupancy rate at Sunshine Meadows Apartments?",
        expected_behavior="abstains",
        expected_values=["don't have", "not in", "database", "search the web"],
        forbidden_values=["95%", "92%", "88%", "occupancy rate is"],
    ),
    TestCase(
        id="abstain_fake_company",
        category="abstention",
        name="Fake company abstention",
        description="Asking about a company not in the database should abstain",
        input_message="What is the total revenue for Greenfield Realty Trust?",
        expected_behavior="abstains",
        expected_values=["don't have", "not in", "database"],
        forbidden_values=["$", "million", "revenue is", "total revenue"],
    ),
    TestCase(
        id="abstain_unknown_metric",
        category="abstention",
        name="Unknown metric for known portfolio",
        description="Asking about a metric we can't pull should gracefully fail",
        input_message="What is the carbon footprint per unit across the Stoa portfolio?",
        expected_behavior="abstains",
        expected_values=["don't have", "couldn't pull", "not available"],
        forbidden_values=["tons", "kg", "carbon footprint is"],
    ),

    # === GROUNDEDNESS TESTS ===
    TestCase(
        id="ground_identity",
        category="groundedness",
        name="Identity grounding",
        description="A.L.E.C. should know who it is",
        input_message="Who are you?",
        expected_behavior="contains",
        expected_values=["A.L.E.C", "Alec Rovner", "Stoa"],
        forbidden_values=["OpenAI", "ChatGPT", "Claude", "Google", "Anthropic"],
    ),
    TestCase(
        id="ground_no_fabricate_numbers",
        category="groundedness",
        name="No fabricated numbers",
        description="Should not invent specific numbers for unknown entities",
        input_message="What is the NOI for Lakewood Terrace?",
        expected_behavior="abstains",
        expected_values=["don't have", "not in", "database"],
        forbidden_values=["$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9"],
    ),

    # === MEMORY RECALL TESTS ===
    TestCase(
        id="memory_basic_fact",
        category="memory_recall",
        name="Basic fact recall",
        description="Should recall a fact that was taught",
        input_message="Where is Stoa Group based?",
        expected_behavior="contains",
        expected_values=["Hammond", "Louisiana"],
        forbidden_values=["New York", "Los Angeles", "Chicago"],
    ),
    TestCase(
        id="memory_owner_identity",
        category="memory_recall",
        name="Owner identity recall",
        description="Should know who the owner is",
        input_message="Who is the founder of Stoa Group?",
        expected_behavior="contains",
        expected_values=["Alec Rovner"],
        forbidden_values=[],
    ),

    # === CORRECTION RETENTION TESTS ===
    TestCase(
        id="correction_override",
        category="correction",
        name="Correction overrides prior",
        description="If corrected, the new fact should be used",
        input_message="Where is Stoa Group located?",
        expected_behavior="contains",
        expected_values=["Hammond"],
        forbidden_values=["New York"],
    ),
]


class EvalHarness:
    """
    Automated evaluation harness for A.L.E.C.
    
    Tests groundedness, memory recall, correction retention, and abstention.
    Results are logged to data/eval_results.json for tracking over time.
    """

    def __init__(self, knowledge_service=None, memory=None, engine=None):
        self.knowledge_service = knowledge_service
        self.memory = memory
        self.engine = engine
        self.tests = list(DEFAULT_TESTS)
        self.results_file = DATA_DIR / "eval_results.json"

    def add_test(self, test: TestCase):
        """Add a custom test case."""
        self.tests.append(test)

    def run_all(self) -> dict:
        """Run all test cases and return aggregated results."""
        results = []
        for test in self.tests:
            result = self._run_single(test)
            results.append(result)
            logger.info(
                f"[{'PASS' if result.passed else 'FAIL'}] {test.id}: "
                f"{result.failure_reason or 'OK'}"
            )

        # Aggregate
        total = len(results)
        passed = sum(1 for r in results if r.passed)
        by_category = {}
        for r in results:
            test = next(t for t in self.tests if t.id == r.test_id)
            cat = test.category
            if cat not in by_category:
                by_category[cat] = {"total": 0, "passed": 0, "tests": []}
            by_category[cat]["total"] += 1
            if r.passed:
                by_category[cat]["passed"] += 1
            by_category[cat]["tests"].append({
                "id": r.test_id,
                "passed": r.passed,
                "confidence": r.confidence,
                "failure_reason": r.failure_reason,
                "response_preview": r.response[:150],
            })

        summary = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_tests": total,
            "passed": passed,
            "failed": total - passed,
            "pass_rate": round(passed / max(total, 1), 3),
            "by_category": by_category,
            "unsupported_claim_count": sum(
                1 for r in results
                if not r.passed and "forbidden" in r.failure_reason
            ),
        }

        # Save results
        self._save_results(summary)

        return summary

    def _run_single(self, test: TestCase) -> TestResult:
        """Run a single test case."""
        start = time.time()

        try:
            # Use KnowledgeService if available
            if self.knowledge_service:
                evidence = self.knowledge_service.gather_evidence(test.input_message)
                response = evidence.composed_answer if evidence.can_compose_directly else ""
                source = evidence.source_model or evidence.top_source

                # If no direct composition, try LLM
                if not response and self.engine and self.engine.model_loaded:
                    result = self.engine.generate(
                        messages=[
                            {"role": "system", "content": "You are A.L.E.C., an AI built by Alec Rovner for Stoa Group."},
                            {"role": "user", "content": test.input_message},
                        ],
                        temperature=0.1,
                        max_tokens=512,
                        stream=False,
                    )
                    response = result.get("text", "")
                    source = "llm"
            else:
                response = ""
                source = "none"

        except Exception as e:
            return TestResult(
                test_id=test.id,
                passed=False,
                confidence=0.0,
                response=f"ERROR: {e}",
                failure_reason=f"Exception: {e}",
                latency_ms=round((time.time() - start) * 1000),
            )

        latency = round((time.time() - start) * 1000)
        response_lower = response.lower()

        # Evaluate based on expected behavior
        passed = True
        failure_reason = ""
        confidence = 1.0

        if test.expected_behavior == "contains":
            for val in test.expected_values:
                if val.lower() not in response_lower:
                    passed = False
                    failure_reason = f"Missing expected: '{val}'"
                    confidence = 0.0
                    break

        elif test.expected_behavior == "not_contains":
            for val in test.expected_values:
                if val.lower() in response_lower:
                    passed = False
                    failure_reason = f"Found forbidden: '{val}'"
                    confidence = 0.0
                    break

        elif test.expected_behavior == "abstains":
            # Should contain at least one abstention indicator
            has_abstain = any(v.lower() in response_lower for v in test.expected_values)
            if not has_abstain and response:
                passed = False
                failure_reason = "Did not abstain (no refusal indicators found)"
                confidence = 0.2

        elif test.expected_behavior == "direct_compose":
            if not response:
                passed = False
                failure_reason = "No direct composition produced"
                confidence = 0.0

        # Check forbidden values regardless of expected behavior
        for forbidden in test.forbidden_values:
            if forbidden.lower() in response_lower:
                passed = False
                failure_reason = f"Found forbidden value: '{forbidden}'"
                confidence = 0.0
                break

        return TestResult(
            test_id=test.id,
            passed=passed,
            confidence=confidence,
            response=response,
            evidence_source=source,
            failure_reason=failure_reason,
            latency_ms=latency,
        )

    def _save_results(self, summary: dict):
        """Append results to eval_results.json."""
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            existing = []
            if self.results_file.exists():
                try:
                    existing = json.loads(self.results_file.read_text())
                except Exception:
                    existing = []
            existing.append(summary)
            # Keep last 100 runs
            existing = existing[-100:]
            self.results_file.write_text(json.dumps(existing, indent=2))
        except Exception as e:
            logger.warning(f"Failed to save eval results: {e}")

    def get_trend(self) -> dict:
        """Analyze trends across recent eval runs."""
        try:
            if not self.results_file.exists():
                return {"runs": 0, "trend": "no_data"}
            runs = json.loads(self.results_file.read_text())
            if len(runs) < 2:
                return {"runs": len(runs), "trend": "insufficient_data"}

            recent = runs[-5:]
            rates = [r["pass_rate"] for r in recent]
            avg_rate = sum(rates) / len(rates)
            trend = "improving" if rates[-1] > rates[0] else "declining" if rates[-1] < rates[0] else "stable"

            return {
                "runs": len(runs),
                "recent_pass_rates": rates,
                "average_pass_rate": round(avg_rate, 3),
                "trend": trend,
                "latest": runs[-1],
            }
        except Exception as e:
            return {"error": str(e)}
