ALTER TABLE legal_acceptances
  ALTER COLUMN accepted_at_ms TYPE bigint;

ALTER TABLE legal_reaccept_requirements
  ALTER COLUMN detected_at_ms TYPE bigint;

ALTER TABLE legal_doc_change_audit_chain
  ALTER COLUMN created_at_ms TYPE bigint;

ALTER TABLE trade_audit
  ALTER COLUMN event_at_ms TYPE bigint;

ALTER TABLE order_intent_audit
  ALTER COLUMN event_at_ms TYPE bigint;

ALTER TABLE grift_signals
  ALTER COLUMN asn TYPE bigint;

ALTER TABLE grift_observations
  ALTER COLUMN asn TYPE bigint;

ALTER TABLE grift_trade_observations
  ALTER COLUMN asn TYPE bigint;

ALTER TABLE auth_events
  ALTER COLUMN asn TYPE bigint;

ALTER TABLE grift_ip_asn_cache
  ALTER COLUMN asn TYPE bigint;

ALTER TABLE grift_ip_asn_ranges
  ALTER COLUMN asn TYPE bigint;
