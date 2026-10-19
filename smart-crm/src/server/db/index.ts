import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { env } from "../env";

export { schema };
export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything queries can run on: the pool or an open transaction. */
export type Executor = Db | Tx;

type Globals = { __crmSql?: postgres.Sql; __crmDb?: Db };
const g = globalThis as unknown as Globals;

/** Raw postgres.js client (singleton; survives dev hot reloads). */
export function sqlClient(): postgres.Sql {
  if (!g.__crmSql) {
    g.__crmSql = postgres(env().DATABASE_URL, {
      max: env().DATABASE_POOL_MAX,
      // Required for Supabase's transaction pooler (Supavisor, port 6543).
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return g.__crmSql;
}

export function db(): Db {
  if (!g.__crmDb) g.__crmDb = drizzle(sqlClient(), { schema });
  return g.__crmDb;
}

/**
 * Runs `fn` in a transaction as the `crm_app` role with the user's id in the
 * request claims, so every statement is subject to row level security.
 * Use for all user-initiated work.
 */
export async function withUserTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role crm_app`);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction with the connection owner's privileges (RLS is
 * bypassed). Only for webhooks, the worker and platform administration — every
 * query must filter by tenant explicitly.
 */
export async function withSystemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(fn);
}

export async function closeDb() {
  if (g.__crmSql) {
    await g.__crmSql.end({ timeout: 5 });
    g.__crmSql = undefined;
    g.__crmDb = undefined;
  }
}
