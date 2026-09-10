CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"allowed_kinds" jsonb NOT NULL,
	"status_order" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"body" text NOT NULL,
	"parent_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"public_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"normalized_title" text NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'inbox' NOT NULL,
	"author_id" text NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"merged_into" text,
	"context" jsonb,
	"embedding" vector(1536),
	"embedding_state" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"item_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"notify_comments" boolean DEFAULT true NOT NULL,
	"notify_status_changes" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "subscriptions_item_id_actor_id_pk" PRIMARY KEY("item_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"item_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "votes_item_id_actor_id_pk" PRIMARY KEY("item_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boards_slug_idx" ON "boards" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "comments_item_idx" ON "comments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "events_item_created_idx" ON "events" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "items_board_state_idx" ON "items" USING btree ("board_id","state");--> statement-breakpoint
CREATE INDEX "items_board_title_idx" ON "items" USING btree ("board_id","normalized_title");--> statement-breakpoint
CREATE INDEX "items_merged_into_idx" ON "items" USING btree ("merged_into");