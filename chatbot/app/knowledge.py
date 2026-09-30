"""Loads the knowledge base from seed/: markdown documents split into sections, plus the product catalog."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .config import ROOT

SEED_DIR = ROOT / "seed"


@dataclass
class Chunk:
    id: str
    document_id: str
    title: str
    heading: str
    content: str
    embedding: list[float] = field(default_factory=list)

    @property
    def text(self) -> str:
        return f"{self.title}: {self.heading}\n{self.content}"


@dataclass
class Document:
    id: str
    title: str
    source_path: str
    audience: str
    chunks: list[Chunk]

    @property
    def checksum(self) -> str:
        return hashlib.sha256("".join(c.text for c in self.chunks).encode()).hexdigest()


def _front_matter(text: str) -> tuple[dict[str, str], str]:
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match:
        return {}, text
    meta = dict(line.split(":", 1) for line in match.group(1).splitlines() if ":" in line)
    return {k.strip(): v.strip() for k, v in meta.items()}, text[match.end() :]


def _unwrap(text: str) -> str:
    """Joins hard-wrapped lines into one line per paragraph or list item (the widget renders one per line)."""
    out: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if out and stripped and out[-1] and not re.match(r"^([-*]|\d+\.)\s", stripped):
            out[-1] += " " + stripped
        else:
            out.append(stripped)
    return "\n".join(out)


def parse_markdown(doc_id: str, text: str, source_path: str) -> Document:
    meta, body = _front_matter(text.replace("\r\n", "\n"))
    title = meta.get("title", doc_id)
    sections = re.split(r"^## +", body, flags=re.M)
    chunks = []
    for section in sections:
        if not section.strip():
            continue
        heading, _, content = section.partition("\n")
        chunks.append(
            Chunk(f"{doc_id}#{len(chunks) + 1}", doc_id, title, heading.strip(), _unwrap(content.strip()))
        )
    return Document(doc_id, title, source_path, meta.get("audience", "all"), chunks)


def catalog_document(models: list[dict]) -> Document:
    """One chunk per model, plus an overview chunk, so "which products..." questions also find something."""
    chunks = [
        Chunk(
            "catalog#1",
            "catalog",
            "Product catalog",
            "All Fieldpiece models covered by the warranty portal",
            "\n".join(f"- {m['code']}: {m['name']} ({m['category']})" for m in models),
        )
    ]
    for m in models:
        chunks.append(
            Chunk(
                f"catalog#{m['code']}",
                "catalog",
                "Product catalog",
                f"{m['code']} {m['name']}",
                f"Model code {m['code']}, category {m['category']}. {m['description']}. "
                f"Warranty: {m.get('warrantyMonths', 12)} months from the date of purchase. "
                f"Serial numbers look like {m['code']}-<9 digits> on the label and in the portal.",
            )
        )
    return Document("catalog", "Product catalog", "seed/products.json", "all", chunks)


def load_models(path: Path = SEED_DIR / "products.json") -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["models"]


def load_documents(models: list[dict] | None = None) -> list[Document]:
    docs = [
        parse_markdown(p.stem, p.read_text(encoding="utf-8"), f"seed/knowledge/{p.name}")
        for p in sorted((SEED_DIR / "knowledge").glob("*.md"))
    ]
    docs.append(catalog_document(models if models is not None else load_models()))
    return docs
