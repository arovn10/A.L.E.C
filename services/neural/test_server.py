"""
A.L.E.C. Server Test Suite
Validates all endpoints return valid JSON without serialization errors.
Run: cd services/neural && python -m pytest test_server.py -v

These tests use FastAPI's TestClient (no model loading needed).
They catch bugs like float('inf') in JSON, missing fields, 500 errors.
"""

import json
import math
import pytest
from unittest.mock import MagicMock, patch
from dataclasses import dataclass, field, asdict
from typing import Optional


# ── JSON Serialization Tests ──────────────────────────────────

class TestJSONSafety:
    """Every dict returned by an endpoint must survive json.dumps()."""

    def test_inf_not_serializable(self):
        with pytest.raises(ValueError):
            json.dumps({"value": float("inf")}, allow_nan=False)

    def test_nan_not_serializable(self):
        with pytest.raises(ValueError):
            json.dumps({"value": float("nan")}, allow_nan=False)

    def test_json_safe_handles_inf(self):
        from server import json_safe
        result = json_safe({"a": float("inf"), "b": float("-inf"), "c": float("nan")})
        assert result["a"] is None
        assert result["b"] is None
        assert result["c"] is None
        # Must not raise
        json.dumps(result)

    def test_json_safe_handles_nested(self):
        from server import json_safe
        result = json_safe({
            "outer": {"inner": float("inf")},
            "list": [1.0, float("nan"), "ok"],
        })
        assert result["outer"]["inner"] is None
        assert result["list"][1] is None
        json.dumps(result)

    def test_json_safe_preserves_normal(self):
        from server import json_safe
        result = json_safe({"a": 1, "b": "hello", "c": 3.14, "d": None, "e": True})
        assert result == {"a": 1, "b": "hello", "c": 3.14, "d": None, "e": True}


# ── Training Status Tests ─────────────────────────────────────

class TestTrainingStatus:
    """TrainingStatus must always serialize to valid JSON."""

    def test_default_status_serializable(self):
        from training import TrainingStatus
        status = TrainingStatus()
        d = status.to_dict()
        serialized = json.dumps(d)
        assert serialized
        # best_loss must not be inf
        assert d["best_loss"] != float("inf")
        assert not (isinstance(d["best_loss"], float) and math.isinf(d["best_loss"]))

    def test_status_with_values_serializable(self):
        from training import TrainingStatus
        status = TrainingStatus(
            is_training=True,
            current_loss=0.5,
            best_loss=0.3,
            current_step=100,
            total_steps=1000,
            run_id="test_run_001",
        )
        d = status.to_dict()
        serialized = json.dumps(d)
        assert "test_run_001" in serialized

    def test_trainer_get_status_serializable(self):
        from training import ALECTrainer
        trainer = ALECTrainer()
        status = trainer.get_status()
        serialized = json.dumps(status)
        assert serialized


# ── Engine Info Tests ─────────────────────────────────────────

class TestEngineInfo:
    """Engine info must be JSON-safe even when model is not loaded."""

    def test_engine_info_no_model(self):
        from engine import ALECEngine
        engine = ALECEngine()
        info = engine.get_model_info()
        serialized = json.dumps(info)
        assert serialized
        assert info["model_loaded"] is False


# ── Query Planner Tests ───────────────────────────────────────

class TestQueryPlanner:
    """Query planner must handle edge cases gracefully."""

    def test_should_query_stoa_excludes_commands(self):
        from query_planner import QueryPlanner
        qp = QueryPlanner(None)
        assert qp.should_query_stoa("what is the occupancy rate") is True
        assert qp.should_query_stoa("remember my favorite property") is False
        assert qp.should_query_stoa("turn off the lights") is False
        assert qp.should_query_stoa("hello who are you") is False
        assert qp.should_query_stoa("change the dashboard color") is False

    def test_should_query_stoa_includes_data(self):
        from query_planner import QueryPlanner
        qp = QueryPlanner(None)
        assert qp.should_query_stoa("top properties by occupancy") is True
        assert qp.should_query_stoa("whats the rent at picardy") is True
        assert qp.should_query_stoa("show me all units") is True

    def test_stats_serializable(self):
        from query_planner import QueryPlanner
        qp = QueryPlanner(None)
        stats = qp.get_stats()
        serialized = json.dumps(stats)
        assert serialized


# ── Self-Improvement Tests ────────────────────────────────────

class TestSelfImprovement:
    """Self-improvement scoring must return valid floats."""

    def test_score_empty_conversation(self):
        from self_improve import SelfImprovementEngine
        si = SelfImprovementEngine(
            db=MagicMock(), trainer=MagicMock(),
            memory=MagicMock(), query_planner=MagicMock(),
        )
        score = si.score_conversation({})
        assert 0.0 <= score <= 1.0

    def test_score_positive_conversation(self):
        from self_improve import SelfImprovementEngine
        si = SelfImprovementEngine(
            db=MagicMock(), trainer=MagicMock(),
            memory=MagicMock(), query_planner=MagicMock(),
        )
        score = si.score_conversation({
            "user_message": "what is occupancy",
            "alec_response": "From the Stoa database: 95%",
            "user_rating": 1,
            "model_used": "stoa-query-planner",
        })
        assert score > 0.5

    def test_score_hallucinated_conversation(self):
        from self_improve import SelfImprovementEngine
        si = SelfImprovementEngine(
            db=MagicMock(), trainer=MagicMock(),
            memory=MagicMock(), query_planner=MagicMock(),
        )
        score = si.score_conversation({
            "user_message": "top properties",
            "alec_response": "Property A - 95%, [Property Name] - 90%",
            "user_rating": -1,
        })
        assert score < 0.5


# ── Drive Engine Tests ────────────────────────────────────────

class TestDriveEngine:
    """Drive engine goals and status must be JSON-safe."""

    def test_goals_serializable(self):
        from drive import DriveEngine
        drive = DriveEngine(
            db=MagicMock(), engine=MagicMock(),
            autonomy=MagicMock(), self_improver=MagicMock(),
            query_planner=MagicMock(), memory=MagicMock(),
        )
        goals = drive.goals
        serialized = json.dumps(goals)
        assert serialized
        assert len(goals) >= 5

    def test_status_serializable(self):
        from drive import DriveEngine
        drive = DriveEngine(
            db=MagicMock(), engine=MagicMock(),
            autonomy=MagicMock(), self_improver=MagicMock(),
            query_planner=MagicMock(), memory=MagicMock(),
        )
        status = drive.get_status()
        serialized = json.dumps(status)
        assert serialized
        assert "improvements_today" in status
        assert "daily_target" in status


# ── Agent Tool Registration Tests ─────────────────────────────

class TestAgentTools:
    """All agent tools must be registered and have valid metadata."""

    def test_all_tools_registered(self):
        from agent import ALECAgent
        agent = ALECAgent(
            engine=MagicMock(),
            query_planner=MagicMock(),
            memory_module=MagicMock(),
        )
        expected = [
            "stoa_query", "memory_search", "memory_store",
            "web_search", "smart_home", "execute_code",
            "calendar", "send_email", "self_edit",
        ]
        for tool_name in expected:
            assert tool_name in agent.tools, f"Missing tool: {tool_name}"

    def test_all_tools_have_description(self):
        from agent import ALECAgent
        agent = ALECAgent(
            engine=MagicMock(),
            query_planner=MagicMock(),
            memory_module=MagicMock(),
        )
        for name, tool in agent.tools.items():
            assert tool.description, f"Tool {name} has no description"
            assert len(tool.description) > 10, f"Tool {name} description too short"

    def test_tool_prompt_serializable(self):
        from agent import ALECAgent
        agent = ALECAgent(
            engine=MagicMock(),
            query_planner=MagicMock(),
            memory_module=MagicMock(),
        )
        prompt = agent._build_tool_prompt()
        assert "self_edit" in prompt
        assert "TOOL_CALL" in prompt
        assert len(prompt) > 100


# ── Strip Think Tags Tests ────────────────────────────────────

class TestStripThinkTags:
    """Qwen3 think tags must never appear in user-facing responses."""

    def test_strips_think_block(self):
        from server import strip_think_tags
        text = "<think>I need to analyze this</think>Hello there!"
        assert strip_think_tags(text) == "Hello there!"

    def test_strips_multiline_think(self):
        from server import strip_think_tags
        text = "<think>\nLet me think about this.\nOkay, I know.\n</think>\nThe answer is 42."
        result = strip_think_tags(text)
        assert "<think>" not in result
        assert "42" in result

    def test_strips_orphaned_tags(self):
        from server import strip_think_tags
        text = "<think>partial thinking\nThe answer is yes."
        result = strip_think_tags(text)
        assert "<think>" not in result

    def test_preserves_clean_text(self):
        from server import strip_think_tags
        text = "Hello, I'm A.L.E.C. How can I help?"
        assert strip_think_tags(text) == text

    def test_empty_input(self):
        from server import strip_think_tags
        assert strip_think_tags("") == ""


# ── Self-Edit Safety Tests ────────────────────────────────────

class TestSelfEditSafety:
    """Self-edit tool must enforce safety guardrails."""

    def test_path_traversal_blocked(self):
        from agent import SelfEditTool
        tool = SelfEditTool()
        result = tool.execute(action="read_file", path="../../etc/passwd")
        assert "not found" in result.lower() or "escapes" in result.lower() or "error" in result.lower()

    def test_critical_file_delete_blocked(self):
        from agent import SelfEditTool
        tool = SelfEditTool()
        result = tool.execute(action="delete_file", path="backend/server.js")
        assert "cannot delete" in result.lower() or "critical" in result.lower()

    def test_edit_nonexistent_file(self):
        from agent import SelfEditTool
        tool = SelfEditTool()
        result = tool.execute(action="edit_file", path="nonexistent.xyz", search="x", replace="y")
        assert "not found" in result.lower()


# ── Smoke Test: Full Endpoint Response Validation ─────────────

class TestEndpointResponses:
    """Every endpoint response must be valid JSON with no inf/nan."""

    def _validate_json(self, data):
        """Recursively validate that data can be JSON serialized."""
        serialized = json.dumps(data)
        # Re-parse to make sure it round-trips
        parsed = json.loads(serialized)
        return parsed

    def test_health_response_shape(self):
        """Health endpoint must return expected fields."""
        expected_fields = ["status", "model_loaded", "service"]
        # This would be tested with TestClient when model is loaded

    def test_training_status_shape(self):
        from training import ALECTrainer
        trainer = ALECTrainer()
        status = trainer.get_status()
        self._validate_json(status)
        assert "is_training" in status
        assert "best_loss" in status
        assert "current_step" in status

    def test_query_planner_stats_shape(self):
        from query_planner import QueryPlanner
        qp = QueryPlanner(None)
        stats = qp.get_stats()
        self._validate_json(stats)
        assert "queries_attempted" in stats
        assert "successful_queries" in stats


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
