/**
 * Generates src/server/db/schema.ts (typed Drizzle table definitions) from a
 * migrated database. SQL migrations stay the single source of truth; CI runs
 * this generator and fails if the committed file differs (schema drift).
 *
 *   DATABASE_URL=... tsx scripts/gen-schema.ts [--check]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const OUT = path.resolve(import.meta.dirname, "..", "src", "server", "db", "schema.ts");

type Column = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_identity: "YES" | "NO";
  is_generated: "ALWAYS" | "NEVER";
  generation_expression: string | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

// JSON columns whose shape the application owns get a precise TS type.
const JSON_TYPES: Record<string, string> = {
  "*.custom_fields": "Record<string, unknown>",
  "*.metadata": "Record<string, unknown>",
  "*.payload": "Record<string, unknown>",
  "tenants.settings": "Record<string, unknown>",
  "plans.limits": "Record<string, number>",
  "tenant_plan_overrides.limits": "Record<string, number>",
};

function jsonType(table: string, column: string): string {
  return JSON_TYPES[`${table}.${column}`] ?? JSON_TYPES[`*.${column}`] ?? "unknown";
}

function columnBuilder(c: Column): { builder: string; imports: string[] } {
  const name = JSON.stringify(c.column_name);
  switch (c.data_type) {
    case "uuid":
      return { builder: `uuid(${name})`, imports: ["uuid"] };
    case "text":
      return { builder: `text(${name})`, imports: ["text"] };
    case "boolean":
      return { builder: `boolean(${name})`, imports: ["boolean"] };
    case "integer":
      return { builder: `integer(${name})`, imports: ["integer"] };
    case "bigint":
      return { builder: `bigint(${name}, { mode: "number" })`, imports: ["bigint"] };
    case "double precision":
      return { builder: `doublePrecision(${name})`, imports: ["doublePrecision"] };
    case "numeric":
      return {
        builder: `numeric(${name}, { precision: ${c.numeric_precision}, scale: ${c.numeric_scale} })`,
        imports: ["numeric"],
      };
    case "date":
      return { builder: `date(${name}, { mode: "string" })`, imports: ["date"] };
    case "timestamp with time zone":
      return { builder: `timestamp(${name}, { withTimezone: true, mode: "date" })`, imports: ["timestamp"] };
    case "jsonb":
      return { builder: `jsonb(${name}).$type<${jsonType(c.table_name, c.column_name)}>()`, imports: ["jsonb"] };
    case "ARRAY":
      if (c.udt_name === "_text") return { builder: `text(${name}).array()`, imports: ["text"] };
      if (c.udt_name === "_uuid") return { builder: `uuid(${name}).array()`, imports: ["uuid"] };
      throw new Error(`Unsupported array type ${c.udt_name} on ${c.table_name}.${c.column_name}`);
    default:
      throw new Error(`Unsupported type ${c.data_type} on ${c.table_name}.${c.column_name}`);
  }
}

async function generate(url: string): Promise<string> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const columns = await sql<Column[]>`
      select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
             c.is_identity, c.is_generated, c.generation_expression, c.numeric_precision, c.numeric_scale
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public'
      order by c.table_name, c.ordinal_position`;
    const pks = await sql<{ table_name: string; columns: string[] }[]>`
      select tc.table_name, array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
      group by tc.table_name`;
    const pkMap = new Map(pks.map((p) => [p.table_name, p.columns]));

    const imports = new Set<string>(["pgTable"]);
    const tables = new Map<string, Column[]>();
    for (const c of columns) {
      if (!tables.has(c.table_name)) tables.set(c.table_name, []);
      tables.get(c.table_name)!.push(c);
    }

    let usesSql = false;
    const blocks: string[] = [];
    for (const [table, cols] of tables) {
      const pk = pkMap.get(table) ?? [];
      const lines = cols.map((c) => {
        const { builder, imports: needed } = columnBuilder(c);
        needed.forEach((i) => imports.add(i));
        let expr = builder;
        if (c.is_identity === "YES") {
          expr += ".generatedAlwaysAsIdentity()";
        } else if (c.is_generated === "ALWAYS") {
          usesSql = true;
          expr += `.generatedAlwaysAs(sql\`${(c.generation_expression ?? "").replace(/`/g, "\\`")}\`)`;
        } else if (c.column_default !== null) {
          usesSql = true;
          expr += `.default(sql\`${c.column_default.replace(/`/g, "\\`")}\`)`;
        }
        if (pk.length === 1 && pk[0] === c.column_name) expr += ".primaryKey()";
        else if (c.is_nullable === "NO") expr += ".notNull()";
        return `  ${camel(c.column_name)}: ${expr},`;
      });
      let extra = "";
      if (pk.length > 1) {
        imports.add("primaryKey");
        extra = `, (t) => [primaryKey({ columns: [${pk.map((p) => `t.${camel(p)}`).join(", ")}] })]`;
      }
      blocks.push(`export const ${camel(table)} = pgTable(${JSON.stringify(table)}, {\n${lines.join("\n")}\n}${extra});`);
    }

    const header = [
      "// AUTO-GENERATED by scripts/gen-schema.ts from supabase/migrations — do not edit.",
      "// Regenerate with `npm run db:generate` after changing a migration.",
      `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/pg-core";`,
      usesSql ? `import { sql } from "drizzle-orm";` : "",
      "",
    ]
      .filter((l, i) => l !== "" || i > 2)
      .join("\n");
    return `${header}\n${blocks.join("\n\n")}\n`;
  } finally {
    await sql.end();
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const output = await generate(url);
if (process.argv.includes("--check")) {
  const current = await readFile(OUT, "utf8").catch(() => "");
  if (current !== output) {
    console.error("src/server/db/schema.ts is out of date with the migrations. Run `npm run db:generate`.");
    process.exit(1);
  }
  console.log("schema.ts is up to date");
} else {
  await writeFile(OUT, output);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}
