"""HTTP API and widget host: uvicorn app.main:app --port 8090

  POST /api/chat           {message, sessionId?}  (+ optional "Authorization: Bearer <WMS access token>")
  POST /api/chat/feedback  {sessionId, messageId, helpful, comment?}
  GET  /api/health         provider, retriever and database status
  GET  /widget.js, /widget.css   the embeddable chat widget;  GET /  a demo page hosting it
"""

from __future__ import annotations

import logging
import re
import uuid

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import guardrails
from .config import ROOT, get_settings
from .embeddings import get_embedder
from .graph import build_graph
from .knowledge import load_documents
from .llm import get_chat_model
from .retriever import InMemoryRetriever, PgRetriever
from .store import TranscriptStore
from .wms_client import WmsClient

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chatbot")

settings = get_settings()
embedder = get_embedder(settings)
store = TranscriptStore(settings.database_url)
if store.healthy():
    retriever = PgRetriever(settings.database_url, embedder)
    retriever_kind = "postgres (pgvector + full-text)"
else:
    log.warning("Knowledge-base database unavailable or empty: using the in-memory index of seed/.")
    retriever = InMemoryRetriever(load_documents(), embedder)
    retriever_kind = "in-memory (seed files)"
graph = build_graph(settings, retriever, get_chat_model(settings), WmsClient(settings.wms_api_url))
limiter = guardrails.RateLimiter(settings.rate_limit_per_minute)

app = FastAPI(title="Fieldpiece Warranty Assistant", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

_SESSION = re.compile(r"^[A-Za-z0-9-]{8,64}$")


class ChatIn(BaseModel):
    message: str = Field(max_length=10_000)
    sessionId: str | None = None


class SourceOut(BaseModel):
    n: int
    id: str
    title: str
    heading: str


class ChatOut(BaseModel):
    sessionId: str
    messageId: str
    answer: str
    intent: str
    sources: list[SourceOut]
    suggestions: list[str]


class FeedbackIn(BaseModel):
    sessionId: str
    messageId: str
    helpful: bool
    comment: str | None = Field(default=None, max_length=1000)


@app.post("/api/chat", response_model=ChatOut)
def chat(body: ChatIn, request: Request, authorization: str | None = Header(default=None)) -> ChatOut:
    session_id = body.sessionId if body.sessionId and _SESSION.match(body.sessionId) else str(uuid.uuid4())
    client_ip = request.client.host if request.client else ""
    if not limiter.allow(f"s:{session_id}", f"ip:{client_ip}"):
        raise HTTPException(status_code=429, detail=guardrails.REFUSALS["rate_limited"])
    token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else None

    result = graph.invoke(
        {"question": body.message, "auth_token": token},
        config={"configurable": {"thread_id": session_id}},
    )
    message_id = str(uuid.uuid4())
    store.log_turn(
        session_id, result.get("clean_question", ""), result["answer"], result.get("intent", ""),
        result.get("sources", []), result.get("guard_events", []),
    )
    return ChatOut(
        sessionId=session_id,
        messageId=message_id,
        answer=result["answer"],
        intent=result.get("intent", "kb"),
        sources=[SourceOut(**s) for s in result.get("sources", [])],
        suggestions=result.get("suggestions", []),
    )


@app.post("/api/chat/feedback", status_code=204)
def feedback(body: FeedbackIn) -> None:
    comment = guardrails.redact_pii(body.comment)[0] if body.comment else None
    store.feedback(body.sessionId, body.messageId, body.helpful, comment)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "llmProvider": settings.llm_provider,
        "llmModel": settings.llm_model if settings.llm_provider != "none" else None,
        "embeddings": settings.embeddings_provider,
        "retriever": retriever_kind,
        "database": store.healthy(),
    }


WEB = ROOT / "web"


@app.get("/", include_in_schema=False)
def demo_page() -> FileResponse:
    return FileResponse(WEB / "index.html")


@app.get("/widget.js", include_in_schema=False)
def widget_js() -> FileResponse:
    return FileResponse(WEB / "widget.js", media_type="text/javascript")


@app.get("/widget.css", include_in_schema=False)
def widget_css() -> FileResponse:
    return FileResponse(WEB / "widget.css", media_type="text/css")


@app.get("/fieldpiece-logo.png", include_in_schema=False)
def logo() -> FileResponse:
    return FileResponse(WEB / "fieldpiece-logo.png", media_type="image/png")
