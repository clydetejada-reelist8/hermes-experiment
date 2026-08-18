-- Enable pgvector for embedding storage and semantic retrieval.
-- Staging uses the vector(1536) type for KnowledgeChunk embeddings
-- (text-embedding-3-small default dimension).
CREATE EXTENSION IF NOT EXISTS vector;
