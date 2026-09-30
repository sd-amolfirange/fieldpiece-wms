"""Seeds the knowledge base: python -m app.ingest [--from-wms] [--reembed]

  --from-wms  refresh the product catalog from the WMS public API (GET /api/public/models) first
  --reembed   re-embed every document (after changing EMBEDDINGS_PROVIDER)
"""

from __future__ import annotations

import argparse
import json

from .config import get_settings
from .embeddings import get_embedder
from .knowledge import SEED_DIR, load_documents, load_models
from .store import force_reembed, upsert_documents
from .wms_client import WmsClient


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-wms", action="store_true")
    parser.add_argument("--reembed", action="store_true")
    args = parser.parse_args()
    settings = get_settings()

    models = load_models()
    if args.from_wms:
        models = WmsClient(settings.wms_api_url).models()
        payload = {"_comment": "Refreshed from the WMS public catalog by app.ingest --from-wms.", "models": models}
        (SEED_DIR / "products.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Catalog refreshed from {settings.wms_api_url}: {len(models)} models")

    if args.reembed:
        force_reembed(settings.database_url)
    stats = upsert_documents(settings.database_url, load_documents(models), get_embedder(settings))
    print(
        f"Knowledge base ready ({settings.embeddings_provider} embeddings): {stats['chunks']} chunks; "
        f"{stats['updated']} documents updated, {stats['unchanged']} unchanged, {stats['removed']} removed."
    )


if __name__ == "__main__":
    main()
