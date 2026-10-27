-- A replay's link preview (a PNG, base64) in ordered pieces like its payload; `image_hash` names the
-- published picture, so publication rewrites it only when it changed and pages can bust caches.
CREATE TABLE replay_images (
  id TEXT NOT NULL,
  n INTEGER NOT NULL,
  chunk TEXT NOT NULL,
  PRIMARY KEY (id, n)
);
ALTER TABLE replays ADD COLUMN image_hash TEXT;
