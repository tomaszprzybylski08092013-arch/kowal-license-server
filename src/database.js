import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function createDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT NOT NULL UNIQUE,
      duration_type TEXT NOT NULL,
      duration_value INTEGER,
      created_at TEXT NOT NULL,
      activated_at TEXT,
      expires_at TEXT,
      status TEXT NOT NULL,
      bound_install_id TEXT,
      session_token TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER NOT NULL,
      install_id TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      mod_version TEXT,
      FOREIGN KEY (license_id) REFERENCES licenses(id)
    );
  `);

  return db;
}

