"""
A.L.E.C. Agent Loop — Tool-calling autonomous agent.

Instead of just generating text, A.L.E.C. can USE TOOLS:
- Search the web
- Query the Stoa database
- Read/write files
- Send emails (via Gmail connector)
- Check calendar
- Control smart home (Home Assistant)
- Read iMessages
- Execute code
- Search memory
- Improve itself (edit its own code, retrain)

Architecture:
  User message → Agent decides: respond directly OR call a tool
  If tool call → execute tool → feed result back → agent responds
  Loop up to MAX_STEPS times (prevents infinite loops)

This is what makes A.L.E.C. an AGENT, not just a chatbot.
The 7B model handles the routing/reasoning, tools handle the actual work.
"""

import json
import logging
import os
import re
import subprocess
import time
from typing import Optional

logger = logging.getLogger("alec.agent")

MAX_AGENT_STEPS = 5  # Max tool calls per message (prevents infinite loops)


class AgentTool:
    """Base class for agent tools."""
    name: str = ""
    description: str = ""
    parameters: dict = {}

    def execute(self, **kwargs) -> str:
        raise NotImplementedError


class StoaQueryTool(AgentTool):
    """Query the Stoa Group real estate database."""
    name = "stoa_query"
    description = "Search the Stoa Group real estate database for property data, occupancy, rent, leasing velocity, loans, contracts, etc. Use this for ANY question about properties, deals, or real estate data."
    parameters = {"query": "Natural language question about Stoa data"}

    def __init__(self, query_planner):
        self.query_planner = query_planner

    def execute(self, query: str = "", **kwargs) -> str:
        result = self.query_planner.get_direct_response(query)
        if result:
            return result
        return "No matching data found in the Stoa database for that query."


class MemorySearchTool(AgentTool):
    """Search A.L.E.C.'s persistent memory."""
    name = "memory_search"
    description = "Search your persistent memory for facts, preferences, and things you've been taught."
    parameters = {"query": "What to search for in memory"}

    def __init__(self, memory):
        self.memory = memory

    def execute(self, query: str = "", **kwargs) -> str:
        results = self.memory.search(query, limit=5)
        if not results:
            return "Nothing found in memory for that query."
        parts = ["From memory:"]
        for r in results:
            parts.append(f"- [{r.get('category', '?')}] {r.get('value', r.get('content', '?'))}")
        return "\n".join(parts)


class MemoryTeachTool(AgentTool):
    """Store a new fact in persistent memory."""
    name = "memory_store"
    description = "Remember a new fact, preference, or piece of information permanently."
    parameters = {"category": "Category (fact, preference, correction, person, project)", "key": "Short label", "value": "The information to remember"}

    def __init__(self, memory):
        self.memory = memory

    def execute(self, category: str = "fact", key: str = "", value: str = "", **kwargs) -> str:
        self.memory.teach(category, key, value, source="agent")
        return f"Stored in memory: [{category}] {key} = {value}"


class WebSearchTool(AgentTool):
    """Search the web for current information."""
    name = "web_search"
    description = "Search the internet for current information, news, facts, prices, or anything not in the local database."
    parameters = {"query": "Search query"}

    def execute(self, query: str = "", **kwargs) -> str:
        api_key = os.getenv("SEARCH_API_KEY", "")
        if not api_key:
            return "Web search not configured. Set SEARCH_API_KEY in .env (Brave Search or SerpAPI)."

        # Try Brave Search API
        try:
            import urllib.request
            import urllib.parse
            url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(query)}&count=5"
            req = urllib.request.Request(url, headers={"X-Subscription-Token": api_key, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            results = data.get("web", {}).get("results", [])
            if not results:
                return "No web results found."
            parts = [f"Web search results for '{query}':"]
            for r in results[:5]:
                parts.append(f"- {r.get('title', '?')}: {r.get('description', '')[:200]}")
            return "\n".join(parts)
        except Exception as e:
            return f"Web search failed: {e}"


class HomeAssistantTool(AgentTool):
    """Control smart home devices via Home Assistant."""
    name = "smart_home"
    description = "Control smart home devices — lights, locks, thermostats, cameras. Turn things on/off, check status, set temperature."
    parameters = {"action": "What to do (e.g., 'turn on living room lights', 'lock front door', 'set thermostat to 72')"}

    def execute(self, action: str = "", **kwargs) -> str:
        ha_url = os.getenv("HA_URL", "")
        ha_token = os.getenv("HA_TOKEN", "")
        if not ha_url or not ha_token:
            return "Home Assistant not configured. Set HA_URL and HA_TOKEN in .env."

        # Parse action into HA API calls
        lower = action.lower()
        try:
            import urllib.request
            headers = {"Authorization": f"Bearer {ha_token}", "Content-Type": "application/json"}

            if any(w in lower for w in ["status", "state", "check", "what"]):
                # Get states
                req = urllib.request.Request(f"{ha_url}/api/states", headers=headers)
                with urllib.request.urlopen(req, timeout=10) as resp:
                    states = json.loads(resp.read())
                # Filter to relevant entities
                relevant = [s for s in states if any(w in s.get("entity_id", "") for w in lower.split())][:10]
                if not relevant:
                    relevant = states[:10]
                parts = ["Smart home status:"]
                for s in relevant:
                    parts.append(f"- {s['attributes'].get('friendly_name', s['entity_id'])}: {s['state']}")
                return "\n".join(parts)
            else:
                return f"I understand the smart home command '{action}' but the specific action parser needs to be configured. Available via Home Assistant at {ha_url}."
        except Exception as e:
            return f"Home Assistant error: {e}"


class CodeExecutionTool(AgentTool):
    """Execute Python code for calculations, data processing, or self-improvement."""
    name = "execute_code"
    description = "Run Python code to calculate something, process data, or perform an action. Use for math, data analysis, file operations, or improving A.L.E.C.'s own code."
    parameters = {"code": "Python code to execute"}

    def execute(self, code: str = "", **kwargs) -> str:
        # Safety: limit execution time and scope
        try:
            result = subprocess.run(
                ["python3", "-c", code],
                capture_output=True, text=True, timeout=30,
                cwd=os.path.dirname(os.path.abspath(__file__)),
            )
            output = result.stdout.strip()
            if result.returncode != 0:
                output = f"Error: {result.stderr.strip()}"
            return output[:2000] if output else "(no output)"
        except subprocess.TimeoutExpired:
            return "Code execution timed out (30s limit)."
        except Exception as e:
            return f"Code execution failed: {e}"


class CalendarTool(AgentTool):
    """Check calendar events and availability."""
    name = "calendar"
    description = "Check your calendar for upcoming events, meetings, and availability."
    parameters = {"query": "What to check (e.g., 'what meetings today', 'am I free Thursday 2pm')"}

    def execute(self, query: str = "", **kwargs) -> str:
        # This would integrate with Google Calendar API
        return "Calendar integration not yet configured. Set up Google Calendar API credentials."


# ═══════════════════════════════════════════════════════════════
#  AGENT LOOP
# ═══════════════════════════════════════════════════════════════

class ALECAgent:
    """
    The agent loop. Takes a user message, decides whether to use tools,
    executes them, and returns a final response.
    """

    def __init__(self, engine, query_planner, memory_module):
        self.engine = engine
        self.tools: dict[str, AgentTool] = {}

        # Register tools
        self._register(StoaQueryTool(query_planner))
        self._register(MemorySearchTool(memory_module))
        self._register(MemoryTeachTool(memory_module))
        self._register(WebSearchTool())
        self._register(HomeAssistantTool())
        self._register(CodeExecutionTool())
        self._register(CalendarTool())

    def _register(self, tool: AgentTool):
        self.tools[tool.name] = tool

    def _build_tool_prompt(self) -> str:
        """Build the tool description for the system prompt."""
        lines = [
            "You have access to the following tools. To use a tool, respond with EXACTLY this format:",
            "",
            "TOOL_CALL: tool_name",
            "ARGS: {\"param\": \"value\"}",
            "",
            "Available tools:",
        ]
        for name, tool in self.tools.items():
            lines.append(f"- **{name}**: {tool.description}")
        lines.append("")
        lines.append("RULES:")
        lines.append("- If the user asks about properties, occupancy, rent, deals, or ANY real estate data → use stoa_query")
        lines.append("- If you don't know something → use web_search or memory_search, don't guess")
        lines.append("- If the user teaches you something → use memory_store")
        lines.append("- If math or code is needed → use execute_code")
        lines.append("- If you CAN answer without tools, just respond normally (no TOOL_CALL)")
        lines.append("- NEVER make up data. If a tool returns no results, say so honestly.")
        return "\n".join(lines)

    def _parse_tool_call(self, response_text: str) -> Optional[tuple[str, dict]]:
        """Parse a TOOL_CALL from the model's response."""
        # Look for TOOL_CALL: tool_name pattern
        match = re.search(r'TOOL_CALL:\s*(\w+)', response_text)
        if not match:
            return None

        tool_name = match.group(1).strip()

        # Parse ARGS
        args = {}
        args_match = re.search(r'ARGS:\s*(\{[^}]+\})', response_text, re.DOTALL)
        if args_match:
            try:
                args = json.loads(args_match.group(1))
            except json.JSONDecodeError:
                # Try to extract key-value pairs manually
                raw = args_match.group(1)
                for kv in re.findall(r'"(\w+)":\s*"([^"]*)"', raw):
                    args[kv[0]] = kv[1]

        # If no ARGS block, try to extract from the context
        if not args and tool_name == "stoa_query":
            # Use the original user message as the query
            args["query"] = ""  # Will be filled by caller

        return (tool_name, args)

    def run(self, user_message: str, messages: list[dict], session_id: str = "") -> dict:
        """
        Run the agent loop.

        Returns: {"text": str, "tool_calls": list, "steps": int}
        """
        start_time = time.time()
        tool_calls_log = []

        # Inject tool descriptions into the system prompt
        tool_prompt = self._build_tool_prompt()

        # Build messages with tool context
        agent_messages = []
        for m in messages:
            agent_messages.append(m)

        # Add tool prompt as a system message
        agent_messages.insert(0, {
            "role": "system",
            "content": tool_prompt,
        })

        for step in range(MAX_AGENT_STEPS):
            # Generate response
            result = self.engine.generate(
                messages=agent_messages,
                temperature=0.3,  # Lower temp for tool routing
                max_tokens=512,
                include_system=True,  # Also includes personality
            )

            response_text = result["text"]

            # Check if the model wants to call a tool
            tool_call = self._parse_tool_call(response_text)

            if not tool_call:
                # No tool call — this is the final response
                return {
                    "text": response_text,
                    "tool_calls": tool_calls_log,
                    "steps": step + 1,
                    "latency_ms": round((time.time() - start_time) * 1000),
                    "prompt_tokens": result.get("prompt_tokens", 0),
                    "completion_tokens": result.get("completion_tokens", 0),
                }

            tool_name, args = tool_call

            # If stoa_query with no query, use the original user message
            if tool_name == "stoa_query" and not args.get("query"):
                args["query"] = user_message

            # Execute the tool
            tool = self.tools.get(tool_name)
            if not tool:
                tool_result = f"Unknown tool: {tool_name}"
            else:
                logger.info(f"Agent step {step+1}: {tool_name}({args})")
                try:
                    tool_result = tool.execute(**args)
                except Exception as e:
                    tool_result = f"Tool error: {e}"

            tool_calls_log.append({
                "tool": tool_name,
                "args": args,
                "result_preview": tool_result[:200],
            })

            # Feed tool result back into the conversation
            agent_messages.append({"role": "assistant", "content": response_text})
            agent_messages.append({
                "role": "system",
                "content": f"[TOOL RESULT from {tool_name}]:\n{tool_result}\n\n[Now respond to the user using the above tool result. Use the REAL data — do NOT make up values.]",
            })

        # If we hit max steps, return what we have
        return {
            "text": "I ran into a processing limit. Here's what I found so far:\n" + (tool_calls_log[-1]["result_preview"] if tool_calls_log else "No results."),
            "tool_calls": tool_calls_log,
            "steps": MAX_AGENT_STEPS,
            "latency_ms": round((time.time() - start_time) * 1000),
            "prompt_tokens": 0,
            "completion_tokens": 0,
        }
