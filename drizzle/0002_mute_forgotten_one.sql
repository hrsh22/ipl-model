CREATE TABLE "trading_execution_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trading_execution_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"intent_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"executor_id" text,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_exposure_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trading_exposure_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"intent_id" integer,
	"fixture_id" text NOT NULL,
	"market_id" text NOT NULL,
	"token_id" text NOT NULL,
	"side" text NOT NULL,
	"entry_type" text NOT NULL,
	"quantity" double precision,
	"notional_usd" double precision NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_recipes" (
	"recipe_key" text PRIMARY KEY NOT NULL,
	"strategy_key" text NOT NULL,
	"recipe_version" text NOT NULL,
	"window_key" text NOT NULL,
	"fixture_id" text NOT NULL,
	"market_id" text NOT NULL,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"side" text NOT NULL,
	"order_style" text NOT NULL,
	"max_price" double precision NOT NULL,
	"size" double precision NOT NULL,
	"expiry_time" timestamp with time zone NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_reconciliation_checkpoints" (
	"checkpoint_key" text PRIMARY KEY NOT NULL,
	"last_cursor" text,
	"last_reconciled_at" timestamp with time zone,
	"details" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_runtime_flags" (
	"flag_key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"reason" text,
	"updated_by" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_trade_intents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trading_trade_intents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"intent_key" text NOT NULL,
	"recipe_key" text NOT NULL,
	"strategy_key" text NOT NULL,
	"recipe_version" text NOT NULL,
	"window_key" text NOT NULL,
	"fixture_id" text NOT NULL,
	"market_id" text NOT NULL,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"side" text NOT NULL,
	"status" text NOT NULL,
	"claim_count" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trading_execution_events" ADD CONSTRAINT "trading_execution_events_intent_id_trading_trade_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."trading_trade_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_exposure_ledger" ADD CONSTRAINT "trading_exposure_ledger_intent_id_trading_trade_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."trading_trade_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_exposure_ledger" ADD CONSTRAINT "trading_exposure_ledger_fixture_id_observer_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."observer_fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_recipes" ADD CONSTRAINT "trading_recipes_fixture_id_observer_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."observer_fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_trade_intents" ADD CONSTRAINT "trading_trade_intents_recipe_key_trading_recipes_recipe_key_fk" FOREIGN KEY ("recipe_key") REFERENCES "public"."trading_recipes"("recipe_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_trade_intents" ADD CONSTRAINT "trading_trade_intents_fixture_id_observer_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."observer_fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trading_execution_events_intent_event_idx" ON "trading_execution_events" USING btree ("intent_id","event_time");--> statement-breakpoint
CREATE INDEX "trading_exposure_ledger_fixture_idx" ON "trading_exposure_ledger" USING btree ("fixture_id","event_time");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_trade_intents_intent_key_idx" ON "trading_trade_intents" USING btree ("intent_key");--> statement-breakpoint
CREATE INDEX "trading_trade_intents_claim_queue_idx" ON "trading_trade_intents" USING btree ("status","claim_expires_at","created_at");
