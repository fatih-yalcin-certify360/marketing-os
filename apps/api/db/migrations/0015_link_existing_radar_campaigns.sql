-- Recover only unambiguous references already frozen in a campaign briefing.
-- Never associate a campaign with a newer or unrelated radar scan.
WITH matches AS (
 SELECT c.id AS campaign_id, min(r.id::text)::uuid AS run_id
 FROM campaigns c JOIN radar_runs r
 ON r.label_id=c.label_id AND r.organization_id=c.organization_id AND r.course_version_id=c.course_version_id
 WHERE c.radar_run_id IS NULL
 AND c.supplied_brief LIKE '%radar-run ' || r.id::text || '%'
 GROUP BY c.id HAVING count(*)=1
)
UPDATE campaigns c SET radar_run_id=m.run_id FROM matches m WHERE c.id=m.campaign_id;
