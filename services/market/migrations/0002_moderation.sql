ALTER TABLE listings ADD COLUMN moderation_hidden INTEGER NOT NULL DEFAULT 0 CHECK(moderation_hidden IN (0,1));
ALTER TABLE listings ADD COLUMN moderation_reason TEXT NOT NULL DEFAULT '' CHECK(length(CAST(moderation_reason AS BLOB)) <= 2048);
ALTER TABLE listings ADD COLUMN moderation_revision INTEGER NOT NULL DEFAULT 0 CHECK(moderation_revision >= 0);
ALTER TABLE version_reviews ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0 CHECK(review_revision >= 0);
ALTER TABLE version_reviews ADD COLUMN reason TEXT NOT NULL DEFAULT '' CHECK(length(CAST(reason AS BLOB)) <= 2048);
ALTER TABLE version_reviews ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0 CHECK(report_count >= 0);

CREATE TABLE moderation_requests (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  operation TEXT NOT NULL CHECK(operation IN ('report','approve','reject','hide','resolve')),
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^a-f0-9]*'),
  expected_sha TEXT NOT NULL CHECK(length(expected_sha)=64 AND expected_sha NOT GLOB '*[^a-f0-9]*'),
  expected_digest TEXT NOT NULL CHECK(length(expected_digest)=64 AND expected_digest NOT GLOB '*[^a-f0-9]*'),
  expected_epoch INTEGER CHECK(expected_epoch >= 0),
  expected_review_revision INTEGER CHECK(expected_review_revision >= 0),
  expected_moderation_revision INTEGER CHECK(expected_moderation_revision >= 0),
  expected_published_version INTEGER CHECK(expected_published_version > 0),
  expected_report_revision INTEGER CHECK(expected_report_revision >= 0),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json) AND length(CAST(receipt_json AS BLOB)) <= 4096),
  UNIQUE(actor_id,idempotency_key),
  UNIQUE(request_id,actor_id,listing_id,version),
  FOREIGN KEY(listing_id,version) REFERENCES listing_versions(listing_id,version)
);

CREATE TABLE reports (
  report_id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_request TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('security','privacy','license','other')),
  explanation TEXT NOT NULL CHECK(length(CAST(explanation AS BLOB)) BETWEEN 1 AND 2048),
  reference_path TEXT CHECK(length(reference_path) BETWEEN 1 AND 512),
  reference_line INTEGER CHECK(reference_line BETWEEN 1 AND 100000),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','resolved')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  UNIQUE(reporter_id,listing_id,version),
  FOREIGN KEY(created_request,reporter_id,listing_id,version) REFERENCES moderation_requests(request_id,actor_id,listing_id,version),
  CHECK((reference_path IS NULL) = (reference_line IS NULL))
);
CREATE INDEX report_quota ON reports(reporter_id,created_at);
CREATE INDEX report_version_page ON reports(listing_id,version,created_at,report_id);
CREATE INDEX pending_review_page ON version_reviews(state,listing_id,version);

CREATE TABLE moderation_events (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL CHECK(length(actor_name) BETWEEN 1 AND 80),
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve','reject','hide','resolve')),
  reason TEXT NOT NULL CHECK(length(CAST(reason AS BLOB)) BETWEEN 1 AND 2048),
  created_at INTEGER NOT NULL,
  self_review INTEGER NOT NULL CHECK(self_review IN (0,1)),
  report_id TEXT,
  FOREIGN KEY(request_id,actor_id,listing_id,version) REFERENCES moderation_requests(request_id,actor_id,listing_id,version),
  FOREIGN KEY(report_id) REFERENCES reports(report_id),
  CHECK((decision='resolve') = (report_id IS NOT NULL))
);
CREATE INDEX moderation_audit_page ON moderation_events(listing_id,version,created_at,request_id);

CREATE TRIGGER publisher_moderation_key BEFORE INSERT ON mutation_requests BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM moderation_requests WHERE actor_id=NEW.owner_id AND idempotency_key=NEW.idempotency_key)
    THEN RAISE(ABORT,'market_idempotency') END);
END;
CREATE TRIGGER moderation_publisher_key BEFORE INSERT ON moderation_requests BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM mutation_requests WHERE owner_id=NEW.actor_id AND idempotency_key=NEW.idempotency_key)
    THEN RAISE(ABORT,'market_idempotency') END);
END;

CREATE TRIGGER report_acceptance_guard BEFORE INSERT ON reports BEGIN
  SELECT (CASE WHEN NOT EXISTS(
    SELECT 1 FROM moderation_requests AS request JOIN listing_versions AS version USING(listing_id,version)
    JOIN listings USING(listing_id) JOIN version_reviews AS review USING(listing_id,version)
    WHERE request.request_id=NEW.created_request AND request.operation='report'
      AND request.created_at=NEW.created_at AND json_extract(request.receipt_json,'$.reportId')=NEW.report_id
      AND version.body_sha256=request.expected_sha AND version.review_digest=request.expected_digest
      AND listings.published_version IS NOT NULL AND listings.moderation_hidden=0 AND review.state='approved'
  ) THEN RAISE(ABORT,'market_report_target') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM reports WHERE reporter_id=NEW.reporter_id AND listing_id=NEW.listing_id AND version=NEW.version)
    THEN RAISE(ABORT,'market_report_duplicate') END);
  SELECT (CASE WHEN (SELECT count(*) FROM reports WHERE reporter_id=NEW.reporter_id AND created_at > NEW.created_at-86400) >= 10
    THEN RAISE(ABORT,'market_report_rate') END);
END;

CREATE TRIGGER report_counter AFTER INSERT ON reports BEGIN
  UPDATE version_reviews SET report_count=report_count+1,review_revision=review_revision+1 WHERE listing_id=NEW.listing_id AND version=NEW.version;
END;

CREATE TRIGGER report_review_revision AFTER UPDATE OF status ON reports WHEN OLD.status<>NEW.status BEGIN
  UPDATE version_reviews SET review_revision=review_revision+1 WHERE listing_id=NEW.listing_id AND version=NEW.version;
END;

CREATE TRIGGER moderation_decision_guard BEFORE INSERT ON moderation_events BEGIN
  SELECT (CASE WHEN NOT EXISTS(
    SELECT 1 FROM moderation_requests AS request JOIN listings USING(listing_id)
    JOIN listing_versions AS version USING(listing_id,version) JOIN version_reviews AS review USING(listing_id,version)
    WHERE request.request_id=NEW.request_id AND request.operation=NEW.decision AND request.created_at=NEW.created_at
      AND version.body_sha256=request.expected_sha AND version.review_digest=request.expected_digest
      AND NEW.self_review=(NEW.actor_id=listings.owner_id)
      AND (NEW.decision='resolve' OR (
        listings.publication_epoch=request.expected_epoch AND listings.moderation_revision=request.expected_moderation_revision
        AND listings.published_version IS request.expected_published_version AND review.review_revision=request.expected_review_revision
        AND ((NEW.decision='hide' AND listings.moderation_hidden=0)
          OR (NEW.decision='reject' AND review.state='pending')
          OR (NEW.decision='approve' AND review.state='pending' AND listings.moderation_hidden=0
            AND version.publication_epoch=listings.publication_epoch
            AND (listings.published_version IS NULL OR listings.published_version < version.version)))
      ))
  ) THEN RAISE(ABORT,'market_stale_review') END);
  SELECT (CASE WHEN NEW.decision='resolve' AND NOT EXISTS(
    SELECT 1 FROM reports JOIN moderation_requests AS request ON request.request_id=NEW.request_id
    WHERE report_id=NEW.report_id AND reports.listing_id=NEW.listing_id AND reports.version=NEW.version
      AND reports.status='open' AND reports.revision=request.expected_report_revision
  ) THEN RAISE(ABORT,'market_stale_report') END);
END;

CREATE TRIGGER moderation_hidden_pointer BEFORE UPDATE OF published_version ON listings
WHEN NEW.published_version IS NOT NULL AND NEW.moderation_hidden=1 BEGIN SELECT RAISE(ABORT,'market_hidden'); END;
CREATE TRIGGER moderation_request_update BEFORE UPDATE ON moderation_requests BEGIN SELECT RAISE(ABORT,'market_immutable'); END;
CREATE TRIGGER moderation_request_delete BEFORE DELETE ON moderation_requests BEGIN SELECT RAISE(ABORT,'market_immutable'); END;
CREATE TRIGGER moderation_event_update BEFORE UPDATE ON moderation_events BEGIN SELECT RAISE(ABORT,'market_immutable'); END;
CREATE TRIGGER moderation_event_delete BEFORE DELETE ON moderation_events BEGIN SELECT RAISE(ABORT,'market_immutable'); END;
CREATE TRIGGER report_identity_update BEFORE UPDATE OF report_id,reporter_id,listing_id,version,created_request,created_at,reason,explanation,reference_path,reference_line ON reports
BEGIN SELECT RAISE(ABORT,'market_immutable'); END;
CREATE TRIGGER report_delete BEFORE DELETE ON reports BEGIN SELECT RAISE(ABORT,'market_immutable'); END;
