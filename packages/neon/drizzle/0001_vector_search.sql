CREATE INDEX IF NOT EXISTS "items_embedding_hnsw_idx" ON "items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_title_trgm_idx" ON "items" USING gin ("normalized_title" gin_trgm_ops);
