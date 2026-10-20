/**
 * Database tooling for local development and CI.
 *
 *   tsx scripts/db.ts migrate   apply pending migrations (supabase/migrations)
 *   tsx scripts/db.ts reset     LOCAL ONLY: drop + recreate the database, apply the
 *                               Supabase stub and all migrations
 *   tsx scripts/db.ts status    list applied / pending migrations
 *
 * Applied versions are tracked in supabase_migrations.schema_migrations, the same
 * table the Supabase CLI uses, so `supabase db push` and this script agree.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const STUB_FILE = path.join(ROOT, "supabase", "local", "00_supabase_stub.sql");

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function listMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return files.map((file) => {
    const match = /^(\d{14})_(.+)\.sql$/.exec(file);
    if (!match) throw new Error(`Invalid migration file name: ${file}`);
    return { file, version: match[1], name: match[2] };
  });
}

async function ensureTracking(sql: postgres.Sql) {
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);
}

async function migrate(url: string, opts: { quiet?: boolean } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await ensureTracking(sql);
    const applied = new Set(
      (await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`).map((r) => r.version),
    );
    let count = 0;
    for (const m of await listMigrations()) {
      if (applied.has(m.version)) continue;
      const body = await readFile(path.join(MIGRATIONS_DIR, m.file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements)
                 values (${m.version}, ${m.name}, ${[body]})`;
      });
      count++;
      if (!opts.quiet) console.log(`applied ${m.file}`);
    }
    if (!opts.quiet) console.log(count ? `${count} migration(s) applied` : "database is up to date");
  } finally {
    await sql.end();
  }
}

async function reset(url: string) {
  if (!isLocalUrl(url) || process.env.APP_ENV === "production") {
    throw new Error("db reset is only allowed against a local database");
  }
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Refusing unusual database name: ${dbName}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`drop database if exists ${dbName} with (force)`);
    await sql.unsafe(`create database ${dbName}`);
  } finally {
    await sql.end();
  }
  const db = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(await readFile(STUB_FILE, "utf8"));
  } finally {
    await db.end();
  }
  await migrate(url, { quiet: true });
  console.log(`reset ${dbName}: stub + migrations applied`);
}

async function status(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await ensureTracking(sql);
    const applied = new Set(
      (await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`).map((r) => r.version),
    );
    for (const m of await listMigrations()) {
      console.log(`${applied.has(m.version) ? "applied" : "PENDING"}  ${m.file}`);
    }
  } finally {
    await sql.end();
  }
}

export { migrate, reset };

const command = process.argv[2];
if (command) {
  const url = databaseUrl();
  const run = command === "migrate" ? migrate(url) : command === "reset" ? reset(url) : command === "status" ? status(url) : null;
  if (!run) {
    console.error("usage: tsx scripts/db.ts <migrate|reset|status>");
    process.exit(1);
  }
  run.catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
