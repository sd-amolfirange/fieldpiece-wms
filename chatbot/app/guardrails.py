"""Guardrails around the model: what goes in, what comes out, and how often.

Input  (before anything reaches the LLM or the log):
  - empty / too long messages are refused;
  - prompt-injection and jailbreak attempts are refused;
  - abusive language is refused politely;
  - personal data (email, phone, card, SSN) is redacted; the model never needs it to answer.
Topic  : the router refuses anything outside Fieldpiece products, warranty, registration, claims and the portal.
Output (before the answer reaches the user):
  - personal data is redacted again (the model may echo something);
  - leaks of the system prompt or internal instructions are replaced;
  - promises the assistant can't make ("your claim will be approved") are replaced with the real rule;
  - knowledge-base answers must be grounded: no retrieved sources -> "I don't know" with a hand-off.
Rate   : a sliding window per session and per client IP.
"""

from __future__ import annotations

import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

INJECTION_PATTERNS = [
    r"ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)",
    r"disregard (all |the )?(previous|prior|above|system)",
    r"forget (all |your )?(previous |prior )?(instructions|rules)",
    r"(reveal|show|print|repeat|output) (me )?(your|the) (system|hidden|initial) (prompt|instructions|message)",
    r"\byou are now\b",
    r"\bact as (an? )?(unrestricted|jailbroken|dan|developer)",
    r"\b(dan|developer|god) mode\b",
    r"\bjailbreak",
    r"pretend (that )?you (have no|are not bound|don't have) (rules|restrictions|guidelines)",
    r"<\s*/?\s*(system|assistant|instructions?)\s*>",
    r"\bsystem prompt\b",
]
_INJECTION = re.compile("|".join(INJECTION_PATTERNS), re.I)

ABUSE_WORDS = ["fuck", "shit", "bitch", "asshole", "bastard", "cunt"]
_ABUSE = re.compile(r"\b(" + "|".join(ABUSE_WORDS) + r")\w*\b", re.I)

_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_PHONE = re.compile(r"(?<![\w-])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b")


def _luhn(number: str) -> bool:
    digits = [int(d) for d in re.sub(r"\D", "", number)][::-1]
    total = sum(d if i % 2 == 0 else (d * 2 - 9 if d * 2 > 9 else d * 2) for i, d in enumerate(digits))
    return len(digits) >= 13 and total % 10 == 0


def redact_pii(text: str) -> tuple[str, list[str]]:
    """Returns the text with personal data masked, and which kinds were found. Serial numbers are kept."""
    found: list[str] = []

    def sub(pattern: re.Pattern[str], label: str, s: str, check=None) -> str:
        def repl(m: re.Match[str]) -> str:
            if check and not check(m.group(0)):
                return m.group(0)
            found.append(label)
            return f"[{label} removed]"

        return pattern.sub(repl, s)

    text = sub(_EMAIL, "email", text)
    text = sub(_CARD, "card number", text, _luhn)
    text = sub(_SSN, "SSN", text)
    text = sub(_PHONE, "phone", text)
    return text, sorted(set(found))


@dataclass
class GuardResult:
    allowed: bool
    text: str
    rule: str | None = None
    message: str | None = None
    notes: list[str] = field(default_factory=list)


REFUSALS = {
    "empty": "Please type a question about your Fieldpiece product, its warranty, registration or a claim.",
    "too_long": "That message is too long for me. Please ask one question at a time, in a few sentences.",
    "prompt_injection": (
        "I can only help with Fieldpiece product warranties, registrations and claims, and I can't change how I "
        "work. What would you like to know about your product?"
    ),
    "abuse": (
        "I'm here to help with your Fieldpiece product. Let's keep it friendly — what can I help you with?"
    ),
    "off_topic": (
        "I can help with Fieldpiece products, warranties, product registration, warranty claims and using the "
        "warranty portal. I can't help with that topic."
    ),
    "rate_limited": "You're sending messages quickly. Please wait a moment and try again.",
    "no_answer": (
        "I don't have that information in the Fieldpiece warranty knowledge base. For this question please contact "
        "the Fieldpiece warranty desk through the portal, or ask your dealer."
    ),
}


def check_input(text: str, max_chars: int) -> GuardResult:
    stripped = (text or "").strip()
    if not stripped:
        return GuardResult(False, "", "empty", REFUSALS["empty"])
    if len(stripped) > max_chars:
        return GuardResult(False, "", "too_long", REFUSALS["too_long"])
    if _INJECTION.search(stripped):
        return GuardResult(False, "", "prompt_injection", REFUSALS["prompt_injection"])
    if _ABUSE.search(stripped):
        return GuardResult(False, "", "abuse", REFUSALS["abuse"])
    clean, found = redact_pii(stripped)
    return GuardResult(True, clean, "pii_redacted" if found else None, notes=found)


_LEAK = re.compile(r"(system prompt|my instructions (are|say)|internal (rules|instructions)|<\s*context\s*>)", re.I)
_PROMISE = re.compile(
    r"\b(your|the) claim (will|is going to|shall) (definitely |certainly |surely )?be (approved|accepted|covered|paid)"
    r"|\b(i|we) (guarantee|promise)\b",
    re.I,
)
PROMISE_REPLACEMENT = "the Fieldpiece warranty desk decides whether a claim is covered after review"


def check_output(answer: str, grounded: bool) -> GuardResult:
    if not grounded:
        return GuardResult(True, REFUSALS["no_answer"], "ungrounded")
    notes: list[str] = []
    if _LEAK.search(answer):
        return GuardResult(True, REFUSALS["no_answer"], "instruction_leak")
    text, found = redact_pii(answer)
    if found:
        notes += found
    if _PROMISE.search(text):
        text = _PROMISE.sub(PROMISE_REPLACEMENT, text)
        notes.append("promise_removed")
    return GuardResult(True, text, "output_edited" if notes else None, notes=notes)


class RateLimiter:
    """Sliding one-minute window per key (session id and client IP)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, *keys: str) -> bool:
        now = time.monotonic()
        windows = [self._hits[k] for k in keys if k]
        for w in windows:
            while w and now - w[0] > 60:
                w.popleft()
        if any(len(w) >= self.per_minute for w in windows):
            return False
        for w in windows:
            w.append(now)
        return True
