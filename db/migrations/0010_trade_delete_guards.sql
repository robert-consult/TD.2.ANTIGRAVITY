-- Guardrails: prevent accidental DELETE/TRUNCATE of trade-history tables.
--
-- Override for intentional maintenance (run inside a transaction):
--   SELECT set_config('tradequip.allow_destructive', '1', true);

CREATE OR REPLACE FUNCTION tradequip_block_destructive_dml() RETURNS trigger AS $$
BEGIN
  IF current_setting('tradequip.allow_destructive', true) = '1' THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION
    'Destructive operation % on %.% is disabled (set tradequip.allow_destructive=1 to override).',
    TG_OP,
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tradequip_no_delete_trades') THEN
    CREATE TRIGGER tradequip_no_delete_trades
    BEFORE DELETE ON trades
    FOR EACH STATEMENT
    EXECUTE FUNCTION tradequip_block_destructive_dml();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tradequip_no_truncate_trades') THEN
    CREATE TRIGGER tradequip_no_truncate_trades
    BEFORE TRUNCATE ON trades
    FOR EACH STATEMENT
    EXECUTE FUNCTION tradequip_block_destructive_dml();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tradequip_no_delete_trade_audit') THEN
    CREATE TRIGGER tradequip_no_delete_trade_audit
    BEFORE DELETE ON trade_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION tradequip_block_destructive_dml();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tradequip_no_truncate_trade_audit') THEN
    CREATE TRIGGER tradequip_no_truncate_trade_audit
    BEFORE TRUNCATE ON trade_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION tradequip_block_destructive_dml();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tradequip_no_delete_order_intent_audit') THEN
    CREATE TRIGGER tradequip_no_delete_order_intent_audit
    BEFORE DELETE ON order_intent_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION tradequip_block_destructive_dml();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tradequip_no_truncate_order_intent_audit') THEN
    CREATE TRIGGER tradequip_no_truncate_order_intent_audit
    BEFORE TRUNCATE ON order_intent_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION tradequip_block_destructive_dml();
  END IF;
END $$;

