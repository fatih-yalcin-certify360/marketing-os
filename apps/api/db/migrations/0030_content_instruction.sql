-- 0030 — the instruction a loose piece was written from (2026-09-17)
--
-- A standalone piece is produced from one sentence the requester types: what
-- the piece should be about, in their own words. That sentence travelled into
-- the prompt and was then thrown away — it lived only in the queue row of the
-- job that wrote the piece, which is operational state, not a record.
--
-- It matters now because a piece can be downloaded as a dossier: the audience
-- it was written for, the instruction it was written from, and the text
-- itself, in one file. Without this column the middle section would either be
-- missing or invented, and inventing it is the worse of the two.

ALTER TABLE content_asset_versions
  ADD COLUMN instruction_nl text;

-- Recover it for the pieces that already exist.
--
-- Not a reconstruction: the job row holds the exact sentence that was sent,
-- and its result holds the id of the asset it produced. Where the job has been
-- pruned the column stays NULL and the dossier says the instruction was not
-- recorded — which is true, and is the only honest thing to print there.
UPDATE content_asset_versions AS c
SET instruction_nl = j.payload ->> 'angleNl'
FROM jobs AS j
WHERE j.type = 'content.standalone'
  AND j.result ->> 'assetId' = c.id::text
  AND j.payload ? 'angleNl'
  AND c.instruction_nl IS NULL;

-- Carry it across the versions of one piece. A hand edit and an AI revision
-- both write a new row for the same `asset_key`, and they were all written
-- from the same original instruction.
UPDATE content_asset_versions AS c
SET instruction_nl = source.instruction_nl
FROM (
  SELECT DISTINCT ON (label_id, asset_key) label_id, asset_key, instruction_nl
  FROM content_asset_versions
  WHERE instruction_nl IS NOT NULL
  ORDER BY label_id, asset_key, version ASC
) AS source
WHERE c.instruction_nl IS NULL
  AND c.label_id = source.label_id
  AND c.asset_key = source.asset_key;
