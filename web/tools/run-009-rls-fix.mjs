import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
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

const sql = fs.readFileSync(
  path.join(root, "docs", "009_fix_sessions_rls_recursion.sql"),
  "utf8"
);

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
  console.log(`MIGRATION_OK (${label})`);
}

try {
  await run(direct, "direct db:5432");
} catch (e) {
  console.error("direct_failed:", e.message);
  await run(poolerUrl, "pooler from .env");
}

if (process.argv.includes("--verify")) {
  const verify = new Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
  });
  await verify.connect();
  const { rows } = await verify.query(`
    SELECT proname, prosecdef AS security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND proname IN ('user_can_access_session', 'user_is_session_host')
    ORDER BY proname
  `);
  await verify.end();
  console.log("VERIFY:", JSON.stringify(rows));
}
