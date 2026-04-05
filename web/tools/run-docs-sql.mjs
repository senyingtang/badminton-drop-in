/**
 * Run a SQL file against Supabase Postgres (prefers direct db.*:5432).
 * Usage: node tools/run-docs-sql.mjs [path-from-repo-root]
 * Example: node tools/run-docs-sql.mjs docs/010_fix_sessions_players_rls_recursion.sql
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const rel = process.argv[2];
if (!rel) {
  console.error("Usage: node tools/run-docs-sql.mjs <path-from-repo-root>");
  process.exit(1);
}
const sqlPath = path.isAbsolute(rel) ? rel : path.join(root, rel);
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const line = envText.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL not found");
const poolerUrl = line.slice("DATABASE_URL=".length).trim();
const u = new URL(poolerUrl.replace(/^postgresql:/, "postgres:"));
const pass = decodeURIComponent(u.password);
const refMatch = u.username?.match(/^postgres\.(.+)$/);
const projectRef = refMatch?.[1] ?? "ngudidpitcfyzmbphlgt";
const direct = `postgresql://postgres:${encodeURIComponent(
  pass
)}@db.${projectRef}.supabase.co:5432/postgres`;

const sql = fs.readFileSync(sqlPath, "utf8");

async function run(url, label) {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  console.log(`SQL_OK (${label}) ${path.basename(sqlPath)}`);
}

try {
  await run(direct, "direct db:5432");
} catch (e) {
  console.error("direct_failed:", e.message);
  await run(poolerUrl, "pooler from .env");
}
