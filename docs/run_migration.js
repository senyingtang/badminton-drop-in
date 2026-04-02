/**
 * run_migration.js
 * 透過 Supabase Management API 執行 SQL migration
 * 用法: node run_migration.js <sql_file_path>
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

// 從 .env 讀取環境變數
const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([A-Z_]+)=(.+)$/);
  if (match) env[match[1]] = match[2].trim();
});

const SUPABASE_URL = env.SUPABASE_URL;   // e.g. https://xxxxx.supabase.co
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// 從 URL 取得 project ref
const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

const sqlFilePath = process.argv[2];
if (!sqlFilePath) {
  console.error('Usage: node run_migration.js <sql_file_path>');
  process.exit(1);
}

const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
console.log(`\n📄 Executing: ${path.basename(sqlFilePath)}`);
console.log(`📊 SQL size: ${sqlContent.length} bytes`);
console.log(`🔗 Project: ${projectRef}\n`);

const postData = JSON.stringify({ query: sqlContent });

const options = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${projectRef}/database/query`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Length': Buffer.byteLength(postData),
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`✅ Migration successful! (HTTP ${res.statusCode})`);
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`📋 Result rows: ${parsed.length}`);
          console.log(JSON.stringify(parsed.slice(0, 5), null, 2));
        }
      } catch (e) {
        if (body && body.length > 0 && body.length < 500) console.log(body);
      }
    } else {
      console.error(`❌ Migration FAILED (HTTP ${res.statusCode})`);
      console.error(body);
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Network error: ${e.message}`);
});

req.write(postData);
req.end();
