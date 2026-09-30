"""The assistant as a LangGraph state machine.

    START -> input_guard --blocked--------------------------------------------> output_guard -> END
                 |
               route --smalltalk--> smalltalk -------------------------------> output_guard
                 |----off_topic--> refuse -----------------------------------> output_guard
                 |----warranty_lookup--> lookup ------------------------------> output_guard
                 '----kb--> retrieve -> grade --none--> no_answer -----------> output_guard
                                          '--found--> generate --------------> output_guard

Conversation memory is kept per session by the checkpointer (thread_id = session id): `history` accumulates the
redacted turns and the router uses it to rewrite follow-up questions ("does it cover that?") into standalone ones.
"""

from __future__ import annotations

import operator
import re
from datetime import date
from typing import Annotated, Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from . import guardrails
from .config import Settings
from .embeddings import tokens
from .prompts import ANSWER_TEMPLATE, GREETING, ROUTER_PROMPT, SUGGESTIONS, SYSTEM_PROMPT
from .retriever import Hit, Retriever
from .wms_client import WmsClient, find_serial

Intent = Literal["kb", "warranty_lookup", "smalltalk", "off_topic", "blocked"]


class Turn(TypedDict):
    role: Literal["user", "assistant"]
    content: str


class Source(TypedDict):
    n: int
    id: str
    title: str
    heading: str


class GuardEvent(TypedDict):
    stage: str
    rule: str
    detail: str


class ChatState(TypedDict, total=False):
    # Input for this turn
    question: str
    auth_token: str | None
    # Working state
    clean_question: str
    search_query: str
    intent: Intent
    serial: str | None
    hits: list[Hit]
    grounded: bool
    draft: str
    # Output of this turn
    answer: str
    sources: list[Source]
    suggestions: list[str]
    guard_events: list[GuardEvent]
    # Across turns (checkpointed per session)
    history: Annotated[list[Turn], operator.add]


class RouteDecision(BaseModel):
    intent: Literal["kb", "warranty_lookup", "smalltalk", "off_topic"]
    standalone_query: str = Field(description="The message rewritten as a standalone search query.")


# ── Offline heuristics (also a fast path before calling the LLM) ────────────────────────────────────────────────

DOMAIN_TERMS = set(
    """fieldpiece warranty warranties guarantee register registered registering registration registrations claim
    claims serial batch label qr scan portal certificate pdf product products model models meter meters clamp
    manifold manifolds pump gauge detector scale anemometer probes probe dealer dealers distributor receipt invoice
    proof purchase purchased bought void expired expire expiring expires replace replacement replaced repair
    repaired credit covered cover coverage login sign password account status pending approved rejected closed
    review bulk upload csv excel xlsx template notification notifications defect broken faulty leak display
    reading power wireless transfer owner desk check lookup""".split()
)
MODEL_CODES = {"sc680", "sc480", "sc260", "sm482v", "sm382v", "jl3kh6", "vp87", "mr45", "mg44", "dr82", "srs1", "sta2"}
_SMALLTALK = re.compile(
    r"^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening)|thanks?( you)?|thank you|thx|ok(ay)?|cool|great|"
    r"who are you|what can you do|help)\b[\s!.?]*$",
    re.I,
)
_LOOKUP_WORDS = re.compile(r"\b(check|status|look ?up|lookup|expire|expiry|expires|covered|coverage|when|valid|"
                           r"warranty|until|still|active)\b", re.I)


def heuristic_route(question: str) -> Intent | None:
    if _SMALLTALK.match(question):
        return "smalltalk"
    serial = find_serial(question)
    if serial and (_LOOKUP_WORDS.search(question) or question.strip().upper() == serial.upper()):
        return "warranty_lookup"
    return None


def is_on_topic(question: str) -> bool:
    words = set(tokens(question))
    return bool(words & DOMAIN_TERMS or words & MODEL_CODES or find_serial(question))


# ── Answer formatting ───────────────────────────────────────────────────────────────────────────────────────────

STATUS_TEXT = {
    "ACTIVE": "Active",
    "EXPIRING_SOON": "Expiring soon",
    "EXPIRED": "Expired",
    "VOID": "Void",
    "PENDING": "Pending (not registered yet)",
}


def us_date(iso: str | None) -> str:
    if not iso:
        return "-"
    d = date.fromisoformat(iso[:10])
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def format_unit(unit: dict) -> str:
    status = unit.get("status", "")
    lines = [
        f"**{unit['serial']}** — {unit.get('modelName', '')}",
        f"- Warranty status: {STATUS_TEXT.get(status, status.title())}",
    ]
    if unit.get("warrantyStart"):
        lines.append(f"- Covered: {us_date(unit.get('warrantyStart'))} to {us_date(unit.get('warrantyEnd'))}")
    if status in ("ACTIVE", "EXPIRING_SOON"):
        lines.append(f"- Days left: {unit.get('daysRemaining', 0)}")
    if unit.get("replacedBySerial"):
        lines.append(f"- Replaced by {unit['replacedBySerial']} (the replacement carries the warranty)")
    if unit.get("void"):
        reason = unit["void"].get("reason", "").replace("_", " ").lower()
        lines.append(f"- Voided by the warranty desk ({reason})")
    if status in ("ACTIVE", "EXPIRING_SOON"):
        lines.append('A fault covered by the warranty can be claimed from the product page with "File a claim".')
    elif status == "PENDING":
        lines.append('Register it with the receipt ("Register a product") to start the warranty.')
    return "\n".join(lines)


def format_context(hits: list[Hit]) -> str:
    return "\n\n".join(
        f"[{i}] {h.chunk.title} — {h.chunk.heading}\n{h.chunk.content}" for i, h in enumerate(hits, start=1)
    )


def extractive_answer(hits: list[Hit]) -> str:
    """Offline answer (LLM_PROVIDER=none): the best matching section, trimmed, with its citation."""
    best = hits[0].chunk
    text = best.content
    if len(text) > 700:
        cut = text[:700]
        text = cut[: max(cut.rfind(". "), cut.rfind("\n")) + 1] or cut
    return f"**{best.heading}**\n{text.strip()} [1]"


def _history_text(history: list[Turn], limit: int = 6) -> str:
    return "\n".join(f"{t['role']}: {t['content']}" for t in history[-limit:]) or "(none)"


def _suggest(question: str, intent: str) -> list[str]:
    q = question.lower()
    if intent == "warranty_lookup":
        return SUGGESTIONS["lookup"]
    if "claim" in q:
        return SUGGESTIONS["claims"]
    if "regist" in q or "serial" in q:
        return SUGGESTIONS["registration"]
    return SUGGESTIONS["default"]


# ── Graph ───────────────────────────────────────────────────────────────────────────────────────────────────────


def build_graph(
    settings: Settings,
    retriever: Retriever,
    llm: BaseChatModel | None,
    wms: WmsClient,
    checkpointer=None,
):
    def input_guard(state: ChatState) -> ChatState:
        result = guardrails.check_input(state["question"], settings.max_input_chars)
        events: list[GuardEvent] = []
        if result.rule:
            events.append({"stage": "input", "rule": result.rule, "detail": ", ".join(result.notes)})
        if not result.allowed:
            return {"intent": "blocked", "draft": result.message or "", "grounded": True, "guard_events": events,
                    "clean_question": "[blocked message]", "sources": [], "serial": None, "hits": []}
        # Reset everything a previous turn left in the checkpointed state (only `history` carries over).
        return {"clean_question": result.text, "guard_events": events, "sources": [], "intent": "kb",
                "serial": None, "hits": [], "draft": "", "grounded": False}

    def route(state: ChatState) -> ChatState:
        question = state["clean_question"]
        serial = find_serial(question)
        fast = heuristic_route(question)
        if fast:
            return {"intent": fast, "serial": serial, "search_query": question}
        if llm is None:
            intent: Intent = "kb" if is_on_topic(question) else "off_topic"
            return {"intent": intent, "serial": serial, "search_query": question}
        try:
            decision = llm.with_structured_output(RouteDecision).invoke(
                ROUTER_PROMPT.format(history=_history_text(state.get("history", [])), question=question)
            )
            intent = decision.intent
            if intent == "warranty_lookup" and not serial:
                intent = "kb"
            query = decision.standalone_query or question
        except Exception:  # noqa: BLE001 - the router must never take the assistant down
            intent, query = ("kb" if is_on_topic(question) else "off_topic"), question
        return {"intent": intent, "serial": serial, "search_query": query}

    def smalltalk(state: ChatState) -> ChatState:
        q = state["clean_question"].lower()
        text = "You're welcome! Anything else about your Fieldpiece product?" if "thank" in q else GREETING
        return {"draft": text, "grounded": True}

    def refuse(state: ChatState) -> ChatState:
        events = state.get("guard_events", []) + [{"stage": "input", "rule": "off_topic", "detail": ""}]
        return {"draft": guardrails.REFUSALS["off_topic"], "grounded": True, "guard_events": events}

    def lookup(state: ChatState) -> ChatState:
        serial = state.get("serial") or ""
        result = wms.lookup(serial, state.get("auth_token"))
        if result.status == "found" and result.unit:
            text = format_unit(result.unit)
        elif result.status == "unauthenticated":
            text = (
                f"To see the warranty for {serial}, please sign in to the warranty portal and open this chat "
                'there, or use "Check warranty" after signing in. For your privacy I can only show products '
                "on your own account."
            )
        elif result.status == "ambiguous":
            text = "That number matches more than one product: " + ", ".join(result.matches or []) + (
                ". Which one do you mean? Include the model code, e.g. SC680-251406233."
            )
        elif result.status == "not_found":
            text = (
                f"I couldn't find {serial} on your account. Check the serial on the label (model code, a dash, "
                'then 9 digits). If you haven\'t registered it yet, use "Register a product" with your receipt.'
            )
        else:
            text = "I can't reach the warranty system right now. Please try again in a moment, or use \"Check warranty\"."
        return {"draft": text, "grounded": True}

    def retrieve(state: ChatState) -> ChatState:
        return {"hits": retriever.search(state.get("search_query") or state["clean_question"], settings.retrieval_top_k)}

    def grade(state: ChatState) -> ChatState:
        hits = [h for h in state.get("hits", []) if h.score >= settings.retrieval_min_score]
        return {"hits": hits, "grounded": bool(hits)}

    def no_answer(state: ChatState) -> ChatState:
        return {"draft": guardrails.REFUSALS["no_answer"], "grounded": True}

    def generate(state: ChatState) -> ChatState:
        hits = state["hits"]
        if llm is None:
            draft = extractive_answer(hits)
        else:
            messages: list[BaseMessage] = [SystemMessage(SYSTEM_PROMPT)]
            for turn in state.get("history", [])[-6:]:
                messages.append(HumanMessage(turn["content"]) if turn["role"] == "user" else AIMessage(turn["content"]))
            messages.append(
                HumanMessage(ANSWER_TEMPLATE.format(context=format_context(hits), question=state["clean_question"]))
            )
            try:
                reply = llm.invoke(messages)
                draft = reply.content if isinstance(reply.content, str) else "".join(
                    part.get("text", "") for part in reply.content if isinstance(part, dict)
                )
            except Exception:  # noqa: BLE001 - fall back to the extractive answer if the model is unavailable
                draft = extractive_answer(hits)
        cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", draft) if 0 < int(n) <= len(hits)})
        used = cited or list(range(1, min(len(hits), 2) + 1))
        sources: list[Source] = [
            {"n": n, "id": hits[n - 1].chunk.id, "title": hits[n - 1].chunk.title, "heading": hits[n - 1].chunk.heading}
            for n in used
        ]
        return {"draft": draft, "sources": sources}

    def output_guard(state: ChatState) -> ChatState:
        result = guardrails.check_output(state.get("draft", ""), state.get("grounded", False))
        events = list(state.get("guard_events", []))
        if result.rule:
            events.append({"stage": "output", "rule": result.rule, "detail": ", ".join(result.notes)})
        sources = state.get("sources", []) if result.rule not in ("ungrounded", "instruction_leak") else []
        intent = state.get("intent", "kb")
        return {
            "answer": result.text,
            "sources": sources,
            "guard_events": events,
            "suggestions": _suggest(state.get("clean_question", ""), intent),
            "history": [
                {"role": "user", "content": state.get("clean_question", "")},
                {"role": "assistant", "content": result.text},
            ],
        }

    g = StateGraph(ChatState)
    for name, fn in [
        ("input_guard", input_guard), ("route", route), ("smalltalk", smalltalk), ("refuse", refuse),
        ("lookup", lookup), ("retrieve", retrieve), ("grade", grade), ("no_answer", no_answer),
        ("generate", generate), ("output_guard", output_guard),
    ]:
        g.add_node(name, fn)
    g.add_edge(START, "input_guard")
    g.add_conditional_edges(
        "input_guard", lambda s: "output_guard" if s.get("intent") == "blocked" else "route",
        ["output_guard", "route"],
    )
    g.add_conditional_edges(
        "route",
        lambda s: {"smalltalk": "smalltalk", "off_topic": "refuse", "warranty_lookup": "lookup"}.get(
            s["intent"], "retrieve"
        ),
        ["smalltalk", "refuse", "lookup", "retrieve"],
    )
    g.add_edge("retrieve", "grade")
    g.add_conditional_edges("grade", lambda s: "generate" if s["grounded"] else "no_answer", ["generate", "no_answer"])
    for name in ("smalltalk", "refuse", "lookup", "no_answer", "generate"):
        g.add_edge(name, "output_guard")
    g.add_edge("output_guard", END)
    return g.compile(checkpointer=checkpointer if checkpointer is not None else InMemorySaver())
