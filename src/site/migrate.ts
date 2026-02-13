import { Pool } from "pg";
import { getEnv } from "../config/env.js";

function requireDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL (required for site:migrate).");
  }
  return databaseUrl;
}

async function main(): Promise<void> {
  const env = getEnv();
  const databaseUrl = requireDatabaseUrl(env.DATABASE_URL);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS podcast_episodes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      subreddits TEXT[] NOT NULL,
      source_url TEXT,
      audio_urls JSONB NOT NULL,
      artifacts JSONB NOT NULL,
      stats JSONB NOT NULL,
      sources JSONB,
      script JSONB
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS podcast_episodes_generated_at_idx ON podcast_episodes (generated_at DESC);`);

  await pool.end();
  console.log("ok: migrated podcast_episodes");
}

await main();

