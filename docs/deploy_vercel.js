const cp = require('child_process')
const fs = require('fs')
const path = require('path')

function getEnv() {
  const envText = fs.readFileSync('../.env', 'utf8')
  const env = {}
  for (const line of envText.split('\n')) {
    if (line.trim() && !line.startsWith('#')) {
      const parts = line.split('=')
      if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim()
      }
    }
  }
  return env
}

const env = getEnv()
const token = env.VERCEL_TOKEN
const projectId = env.VERCEL_PROJECT_ID
const scope = env.VERCEL_SCOPE || 'senyingtangs-projects'
const orgId =
  env.VERCEL_ORG_ID || 'team_SjdFRfNXXidJQkhAugFbazpj'

if (!token) {
  console.error("No VERCEL_TOKEN found")
  process.exit(1)
}

const repoRoot = path.join(__dirname, '..')
// Vercel dashboard "Root Directory" = `web`: link at repo root and run `vercel deploy` (no path arg)

// Create .vercel dir and pin project (empty orgId causes CLI to create a new project)
const vercelDir = path.join(repoRoot, '.vercel')
if (!fs.existsSync(vercelDir)) {
  fs.mkdirSync(vercelDir, { recursive: true })
}

if (projectId) {
  fs.writeFileSync(
    path.join(vercelDir, 'project.json'),
    JSON.stringify({ projectId, orgId })
  )
} else {
  console.warn(
    'VERCEL_PROJECT_ID missing: deploy may attach to wrong Vercel project. Set it in .env.'
  )
}

const exec = (cmd) => {
    console.log(`> ${cmd}`)
    try {
        const result = cp.execSync(cmd, { cwd: repoRoot, stdio: 'inherit' })
        return result ? result.toString() : ''
    } catch(err) {
        throw err
    }
}

try {
    console.log("Deploying to Vercel (Production)...")
    exec(
      `npx --yes vercel deploy --prod --token=${token} --yes --scope ${scope}`
    )
    console.log("Deployment successful!")
} catch(e) {
    console.error("Failed to deploy to Vercel.", e)
}
