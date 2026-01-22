-- Ensure one row per (user_id, doc_set) so ON CONFLICT(user_id, doc_set) works.
-- De-duplicate any historical rows before creating the unique index.

DELETE FROM legal_reaccept_requirements
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, doc_set
        ORDER BY detected_at_ms DESC NULLS LAST, id DESC
      ) AS rn
    FROM legal_reaccept_requirements
  ) t
  WHERE t.rn > 1
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_reaccept_requirements_user_docset
  ON legal_reaccept_requirements (user_id, doc_set);
