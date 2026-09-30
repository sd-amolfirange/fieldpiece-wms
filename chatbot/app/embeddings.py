"""Text embeddings, 384 dimensions (the kb_chunks.embedding column).

- hash:   built in, offline and deterministic (feature hashing of words, word pairs and character trigrams). Good
          enough for a small, domain-specific knowledge base, especially combined with full-text search.
- openai: text-embedding-3-small with `dimensions=384`.
- ollama: a local embedding model (e.g. nomic-embed-text), cut or padded to 384.
Changing the provider changes the vectors: re-run `python -m app.ingest` afterwards.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

from .config import Settings

DIM = 384
_WORD = re.compile(r"[a-z0-9]+")
STOPWORDS = frozenset(
    "a an and are as at be by can do does for from has have how i if in is it its my of on or so that the this to "
    "was what when where which who why will with you your me we our get got".split()
)


def tokens(text: str) -> list[str]:
    return [t for t in _WORD.findall(text.lower()) if t not in STOPWORDS]


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _fit(vec: list[float]) -> list[float]:
    return _normalize((vec + [0.0] * DIM)[:DIM])


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashEmbedder:
    def _one(self, text: str) -> list[float]:
        vec = [0.0] * DIM
        words = tokens(text)
        features: list[tuple[str, float]] = [(w, 1.0) for w in words]
        features += [(f"{a}_{b}", 0.7) for a, b in zip(words, words[1:])]
        for w in words:
            padded = f"#{w}#"
            features += [(padded[i : i + 3], 0.3) for i in range(len(padded) - 2)]
        for feature, weight in features:
            h = int.from_bytes(hashlib.blake2b(feature.encode(), digest_size=8).digest(), "big")
            vec[h % DIM] += weight if (h >> 40) & 1 else -weight
        return _normalize(vec)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]


class OpenAIEmbedder:
    def __init__(self, model: str):
        from langchain_openai import OpenAIEmbeddings

        self._client = OpenAIEmbeddings(model=model, dimensions=DIM)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_fit(v) for v in self._client.embed_documents(texts)]


class OllamaEmbedder:
    def __init__(self, model: str, base_url: str):
        from langchain_ollama import OllamaEmbeddings

        self._client = OllamaEmbeddings(model=model, base_url=base_url)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_fit(v) for v in self._client.embed_documents(texts)]


def get_embedder(settings: Settings) -> Embedder:
    if settings.embeddings_provider == "openai":
        return OpenAIEmbedder(settings.embeddings_model)
    if settings.embeddings_provider == "ollama":
        return OllamaEmbedder(settings.embeddings_model, settings.ollama_base_url)
    return HashEmbedder()
