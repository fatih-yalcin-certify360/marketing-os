CREATE TABLE campaign_package_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 package_id uuid NOT NULL REFERENCES campaign_packages(id) ON DELETE CASCADE,
 reviewer_user_id uuid NOT NULL REFERENCES users(id),
 assessment jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_package_reviews_latest ON campaign_package_reviews(package_id, created_at DESC);
