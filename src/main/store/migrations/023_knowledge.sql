CREATE TABLE kb_documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_path TEXT NOT NULL,
  filename TEXT,
  mime TEXT,
  size_bytes INTEGER,
  tags TEXT,
  status TEXT DEFAULT 'pending',
  error TEXT,
  chunk_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_kb_docs_status ON kb_documents(status);

CREATE TABLE kb_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_kb_chunks_doc ON kb_chunks(document_id);
