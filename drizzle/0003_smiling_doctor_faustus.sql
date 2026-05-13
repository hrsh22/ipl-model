DO $$
DECLARE
  duplicate_scope_count integer;
BEGIN
  SELECT count(*) INTO duplicate_scope_count
  FROM (
    SELECT 1
    FROM "trading_trade_intents"
    WHERE "strategy_key" = 'scoreboard-side-11-13'
    GROUP BY "strategy_key", "window_key", "fixture_id", "market_id", "side"
    HAVING count(*) > 1
  ) duplicate_scopes;

  IF duplicate_scope_count > 0 THEN
    RAISE EXCEPTION 'Cannot create trading_trade_intents_fixture_scope_idx: found % duplicate scoreboard-side fixture scopes. Resolve duplicates by retaining the earliest canonical intent per strategy/window/fixture/market/side before rerunning this migration.', duplicate_scope_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "trading_trade_intents_fixture_scope_idx" ON "trading_trade_intents" USING btree ("strategy_key","window_key","fixture_id","market_id","side") WHERE "trading_trade_intents"."strategy_key" = 'scoreboard-side-11-13';
