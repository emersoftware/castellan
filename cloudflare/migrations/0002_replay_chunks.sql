-- A replay payload is stored in ordered pieces: D1 imports cap one SQL statement at 100 KB and a row at 2 MB.
CREATE TABLE replay_chunks (
  id TEXT NOT NULL,
  n INTEGER NOT NULL,
  chunk TEXT NOT NULL,
  PRIMARY KEY (id, n)
);
INSERT INTO replay_chunks(id, n, chunk) SELECT id, 0, replay_json FROM replays;
UPDATE replays SET summary_json = json_set(summary_json, '$.rulesVersion', json_extract(replay_json, '$.ruleset.version'));
ALTER TABLE replays DROP COLUMN replay_json;
