"""Writes to the chatbot database: knowledge-base upserts, transcript, guardrail events and feedback.

Transcript logging is best effort: if the database is down the assistant keeps answering (and says so in /health).
"""

from __future__ import annotations

import json
import logging

import psycopg
from pgvector.psycopg import register_vector

from .config import ROOT
from .embeddings import Embedder
from .knowledge import Document

log = logging.getLogger("chatbot.store")


def apply_schema(conn: psycopg.Connection) -> None:
    conn.execute((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))


def upsert_documents(database_url: str, documents: list[Document], embedder: Embedder) -> dict[str, int]:
    """Re-embeds only documents whose content changed; removes documents no longer in the seed."""
    stats = {"unchanged": 0, "updated": 0, "removed": 0, "chunks": 0}
    with psycopg.connect(database_url) as conn:
        apply_schema(conn)
        register_vector(conn)
        existing = dict(conn.execute("SELECT id, checksum FROM kb_documents").fetchall())
        for doc in documents:
            stats["chunks"] += len(doc.chunks)
            if existing.get(doc.id) == doc.checksum:
                stats["unchanged"] += 1
                continue
            vectors = embedder.embed([c.text for c in doc.chunks])
            conn.execute("DELETE FROM kb_documents WHERE id = %s", (doc.id,))
            conn.execute(
                "INSERT INTO kb_documents (id, title, source_path, audience, checksum) VALUES (%s, %s, %s, %s, %s)",
                (doc.id, doc.title, doc.source_path, doc.audience, doc.checksum),
            )
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO kb_chunks (id, document_id, heading, content, embedding) VALUES (%s, %s, %s, %s, %s)",
                    [(c.id, doc.id, c.heading, c.content, v) for c, v in zip(doc.chunks, vectors)],
                )
            stats["updated"] += 1
        gone = set(existing) - {d.id for d in documents}
        for doc_id in gone:
            conn.execute("DELETE FROM kb_documents WHERE id = %s", (doc_id,))
        stats["removed"] = len(gone)
    return stats


def force_reembed(database_url: str) -> None:
    with psycopg.connect(database_url) as conn:
        apply_schema(conn)
        conn.execute("UPDATE kb_documents SET checksum = ''")


class TranscriptStore:
    def __init__(self, database_url: str | None):
        self.database_url = database_url

    def _run(self, sql: str, rows: list[tuple]) -> None:
        if not self.database_url or not rows:
            return
        try:
            with psycopg.connect(self.database_url, connect_timeout=3) as conn, conn.cursor() as cur:
                cur.executemany(sql, rows)
        except psycopg.Error as exc:
            log.warning("transcript not stored: %s", exc)

    def log_turn(self, session_id: str, question: str, answer: str, intent: str, sources: list, events: list) -> None:
        self._run(
            "INSERT INTO chat_messages (session_id, role, content, intent, sources) VALUES (%s, %s, %s, %s, %s)",
            [
                (session_id, "user", question, intent, "[]"),
                (session_id, "assistant", answer, intent, json.dumps(sources)),
            ],
        )
        self._run(
            "INSERT INTO guardrail_events (session_id, stage, rule, detail) VALUES (%s, %s, %s, %s)",
            [(session_id, e["stage"], e["rule"], e.get("detail", "")) for e in events],
        )

    def feedback(self, session_id: str, message_id: str, helpful: bool, comment: str | None) -> None:
        self._run(
            "INSERT INTO chat_feedback (session_id, message_id, helpful, comment) VALUES (%s, %s, %s, %s)",
            [(session_id, message_id, helpful, comment)],
        )

    def healthy(self) -> bool:
        if not self.database_url:
            return False
        try:
            with psycopg.connect(self.database_url, connect_timeout=2) as conn:
                return conn.execute("SELECT count(*) FROM kb_chunks").fetchone()[0] > 0
        except psycopg.Error:
            return False
