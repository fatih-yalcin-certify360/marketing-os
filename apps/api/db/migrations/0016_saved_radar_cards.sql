CREATE TABLE radar_saved_cards (
 run_id uuid NOT NULL REFERENCES radar_runs(id) ON DELETE CASCADE,
 card_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (run_id, card_id)
);
