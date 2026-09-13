CREATE TABLE "blocked_actors" (
	"board_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "blocked_actors_board_id_actor_id_pk" PRIMARY KEY("board_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "moderation" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "blocked_actors" ADD CONSTRAINT "blocked_actors_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;