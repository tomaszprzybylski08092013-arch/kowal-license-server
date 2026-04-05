import { Pool } from "pg";

export async function createDatabase(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id BIGSERIAL PRIMARY KEY,
      license_key TEXT NOT NULL UNIQUE,
      duration_type TEXT NOT NULL,
      duration_value INTEGER,
      created_at TIMESTAMPTZ NOT NULL,
      activated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      bound_install_id TEXT,
      session_token TEXT,
      note TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activations (
      id BIGSERIAL PRIMARY KEY,
      license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
      install_id TEXT NOT NULL,
      activated_at TIMESTAMPTZ NOT NULL,
      mod_version TEXT
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licenses_session_token
    ON licenses (session_token);
  `);

  return pool;
}
