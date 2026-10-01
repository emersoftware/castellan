CREATE TABLE replays (
  id TEXT PRIMARY KEY,
  saved_at TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
  replay_json TEXT NOT NULL CHECK(json_valid(replay_json)),
  content_hash TEXT NOT NULL
);
CREATE INDEX replays_saved_at ON replays(saved_at DESC, id);

CREATE TABLE series (
  id TEXT PRIMARY KEY,
  saved_at TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK(json_valid(summary_json))
);
CREATE INDEX series_saved_at ON series(saved_at DESC, id);
