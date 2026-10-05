-- A listing can be a space. SQLite cannot change a CHECK in place, so the listings table is made again with the same
-- columns, rows, index and triggers, and the wider list of kinds. The curated space listing's id is reserved.
--
-- The rows wait in a copy while the table is dropped and made under its own name. There is no rename: a rename
-- refuses to run while the triggers on other tables read a table that is gone. Foreign keys are checked at the end,
-- once the rows are back.
PRAGMA defer_foreign_keys = on;

INSERT INTO reserved_listing_ids VALUES ('launch-space');

CREATE TABLE listings_copy AS SELECT
  listing_id, owner_id, kind, created_request, created_at, published_version, publication_epoch,
  moderation_hidden, moderation_reason, moderation_revision
FROM listings;

DROP TABLE listings;

CREATE TABLE listings (
  listing_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('orglet', 'crew', 'space')),
  created_request TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  published_version INTEGER,
  publication_epoch INTEGER NOT NULL DEFAULT 0 CHECK(publication_epoch >= 0),
  moderation_hidden INTEGER NOT NULL DEFAULT 0 CHECK(moderation_hidden IN (0,1)),
  moderation_reason TEXT NOT NULL DEFAULT '' CHECK(length(CAST(moderation_reason AS BLOB)) <= 2048),
  moderation_revision INTEGER NOT NULL DEFAULT 0 CHECK(moderation_revision >= 0),
  UNIQUE(listing_id, owner_id),
  FOREIGN KEY(created_request, owner_id, listing_id) REFERENCES mutation_requests(request_id, owner_id, listing_id),
  FOREIGN KEY(listing_id, published_version) REFERENCES listing_versions(listing_id, version)
);

INSERT INTO listings (
  listing_id, owner_id, kind, created_request, created_at, published_version, publication_epoch,
  moderation_hidden, moderation_reason, moderation_revision
) SELECT
  listing_id, owner_id, kind, created_request, created_at, published_version, publication_epoch,
  moderation_hidden, moderation_reason, moderation_revision
FROM listings_copy ORDER BY rowid;

DROP TABLE listings_copy;

CREATE INDEX listing_owner ON listings(owner_id, created_at, listing_id);

CREATE TRIGGER listing_capacity_guard BEFORE INSERT ON listings BEGIN
  SELECT CASE WHEN (SELECT operation FROM mutation_requests WHERE request_id = NEW.created_request) != 'create'
    THEN RAISE(ABORT, 'market_request') END;
  SELECT CASE WHEN (SELECT count(*) FROM listings WHERE owner_id = NEW.owner_id) >= (
    SELECT listing_cap FROM mutation_requests WHERE request_id = NEW.created_request
  ) THEN RAISE(ABORT, 'market_capacity') END;
END;

CREATE TRIGGER published_version_guard BEFORE UPDATE OF published_version ON listings
WHEN NEW.published_version IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM listing_versions AS versions JOIN version_reviews AS reviews USING(listing_id, version)
    WHERE versions.listing_id = NEW.listing_id AND versions.version = NEW.published_version
      AND versions.publication_epoch = NEW.publication_epoch AND reviews.state = 'approved'
  ) THEN RAISE(ABORT, 'market_review') END;
END;

CREATE TRIGGER listing_identity_update BEFORE UPDATE OF listing_id, owner_id, kind, created_request, created_at ON listings
BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;
CREATE TRIGGER listing_identity_delete BEFORE DELETE ON listings BEGIN SELECT RAISE(ABORT, 'market_immutable'); END;

CREATE TRIGGER moderation_hidden_pointer BEFORE UPDATE OF published_version ON listings
WHEN NEW.published_version IS NOT NULL AND NEW.moderation_hidden=1 BEGIN SELECT RAISE(ABORT,'market_hidden'); END;
