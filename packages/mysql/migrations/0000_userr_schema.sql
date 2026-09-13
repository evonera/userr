-- MySQL 8 / PlanetScale baseline. InnoDB FULLTEXT offers lexical duplicate
-- suggestions; semantic/vector search is intentionally unsupported here.
-- Every table has a primary key so PlanetScale safe migrations can correlate it.
-- Foreign keys are omitted deliberately: PlanetScale installations may disable
-- them. Repository operations must preserve these relationships transactionally.

CREATE TABLE IF NOT EXISTS boards (
  id varchar(64) NOT NULL, slug varchar(191) NOT NULL, name varchar(255) NOT NULL,
  visibility varchar(16) NOT NULL DEFAULT 'public', allowed_kinds json NOT NULL,
  status_order json NOT NULL, created_at bigint NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY boards_slug_unique (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS items (
  id varchar(64) NOT NULL, board_id varchar(64) NOT NULL, public_id varchar(64) NOT NULL,
  slug varchar(255) NOT NULL, title varchar(1024) NOT NULL, body text NOT NULL,
  normalized_title varchar(1024) NOT NULL, search_text text NOT NULL, kind varchar(32) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'inbox', author_id varchar(255) NOT NULL,
  vote_count int NOT NULL DEFAULT 0, comment_count int NOT NULL DEFAULT 0,
  labels json NOT NULL, merged_into varchar(64) NULL, moderation varchar(32) NOT NULL DEFAULT 'approved',
  context json NULL, embedding_state varchar(32) NOT NULL DEFAULT 'disabled',
  created_at bigint NOT NULL, updated_at bigint NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY items_board_public_unique (board_id, public_id),
  KEY items_board_state_idx (board_id, state), KEY items_board_title_idx (board_id, normalized_title),
  KEY items_merged_into_idx (merged_into), FULLTEXT KEY items_search_fulltext (title, body)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS votes (
  item_id varchar(64) NOT NULL, actor_id varchar(255) NOT NULL, created_at bigint NOT NULL,
  PRIMARY KEY (item_id, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comments (
  id varchar(64) NOT NULL, item_id varchar(64) NOT NULL, actor_id varchar(255) NOT NULL,
  body text NOT NULL, parent_id varchar(64) NULL, created_at bigint NOT NULL,
  updated_at bigint NOT NULL, deleted_at bigint NULL,
  PRIMARY KEY (id), KEY comments_item_idx (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id varchar(64) NOT NULL, item_id varchar(64) NOT NULL, type varchar(64) NOT NULL,
  actor_id varchar(255) NULL, payload json NOT NULL, created_at bigint NOT NULL,
  PRIMARY KEY (id), KEY events_item_created_idx (item_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
  item_id varchar(64) NOT NULL, actor_id varchar(255) NOT NULL,
  notify_comments boolean NOT NULL DEFAULT true, notify_status_changes boolean NOT NULL DEFAULT true,
  created_at bigint NOT NULL, PRIMARY KEY (item_id, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS changelog_entries (
  id varchar(64) NOT NULL, board_id varchar(64) NOT NULL, title varchar(255) NOT NULL,
  slug varchar(255) NOT NULL, body text NOT NULL, version varchar(128) NULL,
  linked_item_ids json NOT NULL, published_at bigint NULL, created_at bigint NOT NULL,
  PRIMARY KEY (id), KEY changelog_board_created_idx (board_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roadmap_lanes (
  id varchar(64) NOT NULL, board_id varchar(64) NOT NULL, name varchar(255) NOT NULL,
  states json NOT NULL, sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (id), KEY lanes_board_order_idx (board_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webhooks (
  id varchar(64) NOT NULL, board_id varchar(64) NOT NULL, url text NOT NULL,
  secret varchar(255) NOT NULL, events json NOT NULL, active boolean NOT NULL DEFAULT true,
  failure_count int NOT NULL DEFAULT 0, last_error text NULL, last_triggered_at bigint NULL,
  created_at bigint NOT NULL, PRIMARY KEY (id), KEY webhooks_board_idx (board_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS deliveries (
  id varchar(64) NOT NULL, webhook_id varchar(64) NOT NULL, event varchar(128) NOT NULL,
  payload json NOT NULL, status varchar(32) NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0,
  next_retry_at bigint NULL, last_error text NULL, delivered_at bigint NULL,
  lease_owner varchar(255) NULL, lease_expires_at bigint NULL, created_at bigint NOT NULL,
  PRIMARY KEY (id), KEY deliveries_webhook_idx (webhook_id),
  KEY deliveries_status_retry_idx (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blocked_actors (
  board_id varchar(64) NOT NULL, actor_id varchar(255) NOT NULL, reason text NULL,
  created_at bigint NOT NULL, PRIMARY KEY (board_id, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
