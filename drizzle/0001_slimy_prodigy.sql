CREATE TABLE "observer_live_model_signals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observer_live_model_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fixture_id" text NOT NULL,
	"snapshot_id" integer,
	"selection" text NOT NULL,
	"model_probability" double precision NOT NULL,
	"polymarket_probability" double precision,
	"reference_probability" double precision,
	"edge_vs_polymarket_bps" integer,
	"reason" text NOT NULL,
	"confidence" text NOT NULL,
	"score_context" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observer_live_model_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observer_live_model_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fixture_id" text NOT NULL,
	"source_event" text NOT NULL,
	"model_version" text NOT NULL,
	"innings" integer,
	"batting_team" text,
	"bowling_team" text,
	"score_runs" integer,
	"score_wickets" integer,
	"overs" double precision,
	"balls" integer,
	"target_runs" integer,
	"expected_runs_now" double precision,
	"expected_wickets_now" double precision,
	"runs_delta" double precision,
	"wickets_delta" double precision,
	"projected_score" double precision,
	"home_model_probability" double precision,
	"away_model_probability" double precision,
	"home_polymarket_probability" double precision,
	"away_polymarket_probability" double precision,
	"home_reference_probability" double precision,
	"away_reference_probability" double precision,
	"edge_home_vs_polymarket_bps" integer,
	"edge_away_vs_polymarket_bps" integer,
	"confidence" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observer_live_model_signals" ADD CONSTRAINT "observer_live_model_signals_fixture_id_observer_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."observer_fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer_live_model_signals" ADD CONSTRAINT "observer_live_model_signals_snapshot_id_observer_live_model_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."observer_live_model_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer_live_model_snapshots" ADD CONSTRAINT "observer_live_model_snapshots_fixture_id_observer_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."observer_fixtures"("id") ON DELETE no action ON UPDATE no action;
