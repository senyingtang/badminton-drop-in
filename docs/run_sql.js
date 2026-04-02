/**
 * run_sql.js — 透過 Supabase Management API 執行 SQL
 * 用法: node run_sql.js <sql_file_path>
 *       node run_sql.js --inline "SELECT 1"
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

// 讀取 .env
const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([A-Z_]+)=(.+)$/);
  if (match) env[match[1]] = match[2].trim();
});

const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = env.SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

let sqlContent;
if (process.argv[2] === '--inline') {
  sqlContent = process.argv[3];
} else {
  const sqlFilePath = process.argv[2];
  if (!sqlFilePath) {
    console.error('Usage: node run_sql.js <sql_file> | --inline "SQL"');
    process.exit(1);
  }
  sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
  console.log(`📄 File: ${path.basename(sqlFilePath)} (${sqlContent.length} bytes)`);
}

console.log(`🔗 Project: ${PROJECT_REF}`);

const postData = JSON.stringify({ query: sqlContent });

const options = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'Content-Length': Buffer.byteLength(postData),
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`✅ Success (HTTP ${res.statusCode})`);
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed)) {
          if (parsed.length > 0) {
            console.log(`📋 Rows: ${parsed.length}`);
            console.log(JSON.stringify(parsed.slice(0, 10), null, 2));
          } else {
            console.log('📋 (no rows returned — DDL executed)');
          }
        } else {
          console.log(JSON.stringify(parsed, null, 2));
        }
      } catch (e) {
        if (body.length < 1000) console.log(body);
        else console.log(body.substring(0, 500) + '...');
      }
    } else {
      console.error(`❌ FAILED (HTTP ${res.statusCode})`);
      try {
        const err = JSON.parse(body);
        console.error(JSON.stringify(err, null, 2));
      } catch (e) {
        console.error(body.substring(0, 1000));
      }
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Network error: ${e.message}`);
  process.exit(1);
});

req.write(postData);
req.end();
