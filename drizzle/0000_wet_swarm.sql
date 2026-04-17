CREATE TABLE "observer_checkpoints" (
	"stream_key" text PRIMARY KEY NOT NULL,
	"last_entry_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observer_fixtures" (
	"id" text PRIMARY KEY NOT NULL,
	"optic_odds_game_id" text NOT NULL,
	"sport" text NOT NULL,
	"league" text NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_team_id" text,
	"away_team_id" text,
	"start_time" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"is_live" boolean NOT NULL,
	"venue_name" text,
	"venue_location" text,
	"polymarket_event_slug" text,
	"polymarket_market_slug" text,
	"polymarket_condition_id" text,
	"home_token_id" text,
	"away_token_id" text,
	"last_score" text,
	"last_period" text,
	"last_result_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observer_odds" (
	"id" text PRIMARY KEY NOT NULL,
	"fixture_id" text NOT NULL,
	"sportsbook_id" text NOT NULL,
	"sportsbook" text NOT NULL,
	"market_id" text NOT NULL,
	"market" text NOT NULL,
	"selection" text NOT NULL,
	"normalized_selection" text NOT NULL,
	"price_probability" double precision NOT NULL,
	"is_main" boolean NOT NULL,
	"is_live" boolean NOT NULL,
	"is_locked" boolean NOT NULL,
	"max_stake" double precision,
	"odds_timestamp" timestamp with time zone NOT NULL,
	"source_ids" jsonb,
	"order_book" jsonb,
	"deep_link" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observer_signals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observer_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fixture_id" text NOT NULL,
	"market_slug" text,
	"selection" text NOT NULL,
	"reference_source" text NOT NULL,
	"reference_probability" double precision NOT NULL,
	"reference_timestamp" timestamp with time zone NOT NULL,
	"polymarket_price" double precision NOT NULL,
	"polymarket_best_level" double precision,
	"polymarket_timestamp" timestamp with time zone NOT NULL,
	"edge_to_price_bps" integer NOT NULL,
	"edge_to_best_level_bps" integer,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observer_odds" ADD CONSTRAINT "observer_odds_fixture_id_observer_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."observer_fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer_signals" ADD CONSTRAINT "observer_signals_fixture_id_observer_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."observer_fixtures"("id") ON DELETE no action ON UPDATE no action;