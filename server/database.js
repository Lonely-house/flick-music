"use strict";
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
function openDatabase(storageDir) {
  fs.mkdirSync(storageDir, { recursive: true });
  const db = new Database(path.join(storageDir, "music.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (db.pragma("user_version", { simple: true }) > 3) {
    db.close();
    throw new Error("Database schema is newer than this application");
  }
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, nickname TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
        csrf_token TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_device ON sessions(device_id);
      CREATE TABLE IF NOT EXISTS audio_blobs (
        id TEXT PRIMARY KEY, sha256 TEXT UNIQUE NOT NULL, filename TEXT UNIQUE NOT NULL,
        mime_type TEXT NOT NULL, file_size INTEGER NOT NULL CHECK(file_size > 0),
        state TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_tracks (
        id TEXT PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id),
        blob_id TEXT NOT NULL REFERENCES audio_blobs(id), display_name TEXT NOT NULL,
        original_filename TEXT NOT NULL, source_device_id TEXT REFERENCES devices(id),
        visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)), duration REAL, created_at INTEGER NOT NULL,
        UNIQUE(owner_device_id, blob_id)
      );
      CREATE INDEX IF NOT EXISTS tracks_owner ON library_tracks(owner_device_id, visible, created_at);
      CREATE INDEX IF NOT EXISTS tracks_blob ON library_tracks(blob_id);
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY, a_id TEXT NOT NULL REFERENCES devices(id), b_id TEXT NOT NULL REFERENCES devices(id),
        status TEXT NOT NULL, created_at INTEGER NOT NULL, ended_at INTEGER, reason TEXT, CHECK(a_id <> b_id)
      );
      CREATE TABLE IF NOT EXISTS pair_members (
        device_id TEXT PRIMARY KEY REFERENCES devices(id), pair_id TEXT NOT NULL REFERENCES pairings(id)
      );
      CREATE INDEX IF NOT EXISTS pair_members_pair ON pair_members(pair_id);
      CREATE TABLE IF NOT EXISTS pairing_requests (
        id TEXT PRIMARY KEY, requester_id TEXT NOT NULL REFERENCES devices(id), target_id TEXT NOT NULL REFERENCES devices(id),
        status TEXT NOT NULL, pair_id TEXT REFERENCES pairings(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        CHECK(requester_id <> target_id)
      );
      CREATE INDEX IF NOT EXISTS requests_pending ON pairing_requests(status, requester_id, target_id);
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY, request_key TEXT NOT NULL, pair_id TEXT NOT NULL REFERENCES pairings(id),
        sender_id TEXT NOT NULL REFERENCES devices(id), receiver_id TEXT NOT NULL REFERENCES devices(id),
        sender_track_id TEXT NOT NULL, receiver_track_id TEXT NOT NULL,
        blob_id TEXT REFERENCES audio_blobs(id) ON DELETE SET NULL,
        track_name TEXT NOT NULL, status TEXT NOT NULL, playback_status TEXT NOT NULL,
        current_time REAL NOT NULL CHECK(current_time >= 0), is_playing INTEGER NOT NULL,
        direction TEXT NOT NULL, interaction TEXT NOT NULL DEFAULT 'swipe', sender_socket_id TEXT NOT NULL, receiver_socket_id TEXT NOT NULL,
        created_receiver_track INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        delivered_at INTEGER, completed_at INTEGER, message TEXT,
        UNIQUE(sender_id, request_key)
      );
      CREATE INDEX IF NOT EXISTS transfers_active ON transfers(status, blob_id);
      CREATE INDEX IF NOT EXISTS transfers_devices ON transfers(sender_id, receiver_id, status);
    `);
    // Idempotent migration for early V2 databases; V1 had no SQLite ownership DB.
    if (
      !db
        .prepare("PRAGMA table_info(library_tracks)")
        .all()
        .some((c) => c.name === "duration")
    )
      db.exec("ALTER TABLE library_tracks ADD COLUMN duration REAL");
    if (!db.prepare("PRAGMA table_info(transfers)").all()
        .some((c) => c.name === "interaction")) {
      db.exec("ALTER TABLE transfers ADD COLUMN interaction TEXT NOT NULL DEFAULT 'swipe'");
    }
    db.pragma("user_version = 3");
  })();
  return db;
}
module.exports = { openDatabase };
