-- Warranty assistant knowledge base and conversation log (PostgreSQL 16 + pgvector).
-- Applied automatically by docker-compose on first start; `python -m app.ingest` also runs it (idempotent).

CREATE EXTENSION IF NOT EXISTS vector;

-- One source document (a markdown file under seed/knowledge, or a generated catalog page).
CREATE TABLE IF NOT EXISTS kb_documents (
  id          TEXT PRIMARY KEY,           -- e.g. "warranty-policy"
  title       TEXT NOT NULL,
  source_path TEXT NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'all',-- all | customer | dealer | admin
  checksum    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Retrieval unit: a section of a document. Searched two ways and fused (hybrid retrieval):
-- dense vectors (pgvector, cosine) and Postgres full-text search (tsvector, English).
CREATE TABLE IF NOT EXISTS kb_chunks (
  id          TEXT PRIMARY KEY,           -- "<document id>#<n>"
  document_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  heading     TEXT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(384) NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || content)) STORED
);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx ON kb_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS kb_chunks_document_idx ON kb_chunks (document_id);

-- Conversation transcript (PII already redacted by the guardrails before it is stored).
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,              -- user | assistant
  content     TEXT NOT NULL,
  intent      TEXT,
  sources     JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);

-- Every guardrail decision that blocked or changed a message, for review and tuning.
CREATE TABLE IF NOT EXISTS guardrail_events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  stage       TEXT NOT NULL,              -- input | output
  rule        TEXT NOT NULL,              -- e.g. prompt_injection, pii_redacted, off_topic, ungrounded
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thumbs up / down from the widget.
CREATE TABLE IF NOT EXISTS chat_feedback (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  helpful     BOOLEAN NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
