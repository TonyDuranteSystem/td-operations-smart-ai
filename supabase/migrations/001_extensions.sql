-- 001_extensions.sql
-- Enable required Postgres extensions for Smart AI TD Operations.
-- Idempotent: all statements use IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector for embeddings (S0.9 v1_scars, shadow_diffs)
