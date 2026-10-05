CREATE TABLE mutation_requests (
  request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  operation TEXT NOT NULL CHECK(operation IN ('create', 'version', 'unpublish')),
  listing_id TEXT NOT NULL CHECK(length(listing_id) BETWEEN 1 AND 80 AND listing_id NOT GLOB '*[^a-z0-9-]*'),
  request_digest TEXT NOT NULL CHECK(length(request_digest) = 64 AND request_digest NOT GLOB '*[^a-f0-9]*'),
  listing_cap INTEGER NOT NULL CHECK(listing_cap BETWEEN 0 AND 10),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  result_version INTEGER CHECK(result_version > 0),
  result_epoch INTEGER CHECK(result_epoch >= 0),
  UNIQUE(owner_id, idempotency_key),
  UNIQUE(request_id, owner_id, listing_id)
);

CREATE TABLE reserved_listing_ids (listing_id TEXT PRIMARY KEY);
INSERT INTO reserved_listing_ids VALUES ('research-friend'), ('research-review');

CREATE TABLE listings (
  listing_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('orglet', 'crew')),
  created_request TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  published_version INTEGER,
  publication_epoch INTEGER NOT NULL DEFAULT 0 CHECK(publication_epoch >= 0),
  UNIQUE(listing_id, owner_id),
  FOREIGN KEY(created_request, owner_id, listing_id) REFERENCES mutation_requests(request_id, owner_id, listing_id),
  FOREIGN KEY(listing_id, published_version) REFERENCES listing_versions(listing_id, version)
);

CREATE TABLE listing_versions (
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  request_id TEXT NOT NULL UNIQUE,
  submitted_by TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  publication_epoch INTEGER NOT NULL CHECK(publication_epoch >= 0),
  author_name TEXT NOT NULL CHECK(length(author_name) BETWEEN 1 AND 80),
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json) AND length(CAST(metadata_json AS BLOB)) <= 65536),
  body_sha256 TEXT NOT NULL CHECK(length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^a-f0-9]*'),
  review_digest TEXT NOT NULL CHECK(length(review_digest) = 64 AND review_digest NOT GLOB '*[^a-f0-9]*'),
  body_bytes INTEGER NOT NULL CHECK(body_bytes BETWEEN 1 AND 2097152),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 8),
  PRIMARY KEY(listing_id, version),
  FOREIGN KEY(listing_id, submitted_by) REFERENCES listings(listing_id, owner_id),
  FOREIGN KEY(request_id, submitted_by, listing_id) REFERENCES mutation_requests(request_id, owner_id, listing_id)
);

CREATE TABLE version_body_chunks (
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
  body BLOB NOT NULL CHECK(typeof(body) = 'blob' AND length(body) BETWEEN 1 AND 262144),
  PRIMARY KEY(listing_id, version, ordinal),
  FOREIGN KEY(listing_id, version) REFERENCES listing_versions(listing_id, version)
);

CREATE TABLE version_reviews (
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'approved', 'rejected')),
  PRIMARY KEY(listing_id, version),
  FOREIGN KEY(listing_id, version) REFERENCES listing_versions(listing_id, version)
);

CREATE INDEX listing_owner ON listings(owner_id, created_at, listing_id);
CREATE INDEX submission_hour ON listing_versions(submitted_by, submitted_at);

CREATE TRIGGER request_target_guard BEFORE INSERT ON mutation_requests BEGIN
  SELECT (CASE WHEN NEW.operation != 'create' AND NOT EXISTS (
    SELECT 1 FROM listings WHERE listing_id = NEW.listing_id AND owner_id = NEW.owner_id
  ) THEN RAISE(ABORT, 'market_owner') END);
  SELECT (CASE WHEN EXISTS (SELECT 1 FROM reserved_listing_ids WHERE listing_id = NEW.listing_id)
    THEN RAISE(ABORT, 'market_reserved') END);
END;

CREATE TRIGGER listing_capacity_guard BEFORE INSERT ON listings BEGIN
  SELECT (CASE WHEN (SELECT operation FROM mutation_requests WHERE request_id = NEW.created_request) != 'create'
    THEN RAISE(ABORT, 'market_request') END);
  SELECT (CASE WHEN (SELECT count(*) FROM listings WHERE owner_id = NEW.owner_id) >= (
    SELECT listing_cap FROM mutation_requests WHERE request_id = NEW.created_request
  ) THEN RAISE(ABORT, 'market_capacity') END);
END;

CREATE TRIGGER version_submission_guard BEFORE INSERT ON listing_versions BEGIN
  SELECT (CASE WHEN json_extract(NEW.metadata_json, '$.kind') != (
    SELECT kind FROM listings WHERE listing_id = NEW.listing_id
  ) THEN RAISE(ABORT, 'market_kind') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM mutation_requests WHERE request_id = NEW.request_id AND owner_id = NEW.submitted_by
      AND listing_id = NEW.listing_id AND result_version = NEW.version AND operation IN ('create', 'version')
      AND created_at = NEW.submitted_at
  ) THEN RAISE(ABORT, 'market_request') END);
  SELECT (CASE WHEN NEW.publication_epoch != (
    SELECT publication_epoch FROM listings WHERE listing_id = NEW.listing_id
  ) THEN RAISE(ABORT, 'market_epoch') END);
  SELECT (CASE WHEN (SELECT count(*) FROM listing_versions
    WHERE submitted_by = NEW.submitted_by AND submitted_at > NEW.submitted_at - 3600) >= 5
    THEN RAISE(ABORT, 'market_rate') END);
END;

CREATE TRIGGER review_complete_guard BEFORE INSERT ON version_reviews BEGIN
  SELECT (CASE WHEN NEW.state != 'pending' THEN RAISE(ABORT, 'market_pending') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM listing_versions AS versions WHERE versions.listing_id = NEW.listing_id AND versions.version = NEW.version
      AND versions.chunk_count = (SELECT count(*) FROM version_body_chunks WHERE listing_id = NEW.listing_id AND version = NEW.version)
      AND versions.body_bytes = (SELECT sum(length(body)) FROM version_body_chunks WHERE listing_id = NEW.listing_id AND version = NEW.version)
      AND versions.chunk_count - 1 = (SELECT max(ordinal) FROM version_body_chunks WHERE listing_id = NEW.listing_id AND version = NEW.version)
  ) THEN RAISE(ABORT, 'market_chunks') END);
END;

CREATE TRIGGER published_version_guard BEFORE UPDATE OF published_version ON listings
WHEN NEW.published_version IS NOT NULL BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM listing_versions AS versions JOIN version_reviews AS reviews USING(listing_id, version)
    WHERE versions.listing_id = NEW.listing_id AND versions.version = NEW.published_version
      AND versions.publication_epoch = NEW.publication_epoch AND reviews.state = 'approved'
  ) THEN RAISE(ABORT, 'market_review') END);
END;

CREATE TRIGGER receipt_immutable_update BEFORE UPDATE ON mutation_requests BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER receipt_immutable_delete BEFORE DELETE ON mutation_requests BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER version_immutable_update BEFORE UPDATE ON listing_versions BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER version_immutable_delete BEFORE DELETE ON listing_versions BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER chunk_immutable_update BEFORE UPDATE ON version_body_chunks BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER chunk_immutable_delete BEFORE DELETE ON version_body_chunks BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER listing_identity_update BEFORE UPDATE OF listing_id, owner_id, kind, created_request, created_at ON listings
BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER listing_identity_delete BEFORE DELETE ON listings BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
