"""Hybrid retrieval: dense vectors + full-text search, reranked with one scoring function (0..1).

Candidates come from pgvector (cosine) and Postgres full-text search in the database, or from memory when no
database is configured (tests, quick demos). Every candidate is then scored the same way:
    score = 0.6 * cosine similarity + 0.4 * share of the question's terms found in the chunk
so RETRIEVAL_MIN_SCORE means the same thing whichever store is used.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol

from .embeddings import Embedder, tokens
from .knowledge import Chunk, Document


@dataclass
class Hit:
    chunk: Chunk
    score: float


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def _term_overlap(query: str, text: str) -> float:
    q = set(tokens(query))
    if not q:
        return 0.0
    t = set(tokens(text))
    # Prefix match so "registering" finds "register", "claims" finds "claim".
    found = sum(1 for w in q if w in t or any(x.startswith(w[:5]) for x in t if len(w) >= 5))
    return found / len(q)


def score(query: str, query_vec: list[float], chunk: Chunk) -> float:
    return max(0.0, 0.6 * _cosine(query_vec, chunk.embedding) + 0.4 * _term_overlap(query, chunk.text))


class Retriever(Protocol):
    def search(self, query: str, k: int) -> list[Hit]: ...


class InMemoryRetriever:
    def __init__(self, documents: list[Document], embedder: Embedder):
        self.embedder = embedder
        self.chunks = [c for d in documents for c in d.chunks]
        for chunk, vec in zip(self.chunks, embedder.embed([c.text for c in self.chunks])):
            chunk.embedding = vec

    def search(self, query: str, k: int) -> list[Hit]:
        qv = self.embedder.embed([query])[0]
        hits = [Hit(c, score(query, qv, c)) for c in self.chunks]
        return sorted(hits, key=lambda h: h.score, reverse=True)[:k]


class PgRetriever:
    def __init__(self, database_url: str, embedder: Embedder, candidates: int = 20):
        self.database_url = database_url
        self.embedder = embedder
        self.candidates = candidates

    def search(self, query: str, k: int) -> list[Hit]:
        import psycopg
        from pgvector.psycopg import register_vector

        qv = self.embedder.embed([query])[0]
        sql = """
          WITH dense AS (
            SELECT id FROM kb_chunks ORDER BY embedding <=> %(vec)s::vector LIMIT %(n)s
          ), lexical AS (
            SELECT id FROM kb_chunks, websearch_to_tsquery('english', %(q)s) query
            WHERE tsv @@ query ORDER BY ts_rank(tsv, query) DESC LIMIT %(n)s
          )
          SELECT c.id, c.document_id, d.title, c.heading, c.content, c.embedding
          FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
          WHERE c.id IN (SELECT id FROM dense UNION SELECT id FROM lexical)
        """
        with psycopg.connect(self.database_url) as conn:
            register_vector(conn)
            rows = conn.execute(sql, {"vec": qv, "q": query, "n": self.candidates}).fetchall()
        hits = []
        for cid, doc_id, title, heading, content, emb in rows:
            vec = emb.to_list() if hasattr(emb, "to_list") else list(emb)
            chunk = Chunk(cid, doc_id, title, heading, content, vec)
            hits.append(Hit(chunk, score(query, qv, chunk)))
        return sorted(hits, key=lambda h: h.score, reverse=True)[:k]
