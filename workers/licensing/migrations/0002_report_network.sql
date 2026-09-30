-- The network (hashed, as in catalog_attempts) each report came from, so
-- one network making up install ids can be capped. Older rows have none.
ALTER TABLE catalog_reports ADD COLUMN network TEXT;
CREATE INDEX catalog_reports_network ON catalog_reports (network, at);
