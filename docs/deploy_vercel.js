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

if (!token) {
  console.error("No VERCEL_TOKEN found")
  process.exit(1)
}

const rootDir = 'd:\\project\\badminton\\web'

// Create .vercel dir to link the project
const vercelDir = path.join(rootDir, '.vercel')
if (!fs.existsSync(vercelDir)) {
  fs.mkdirSync(vercelDir)
}

if (projectId) {
  fs.writeFileSync(path.join(vercelDir, 'project.json'), JSON.stringify({
    projectId: projectId,
    orgId: env.VERCEL_ORG_ID || ""
  }))
}

const exec = (cmd) => {
    console.log(`> ${cmd}`)
    try {
        const result = cp.execSync(cmd, { cwd: rootDir, stdio: 'inherit' })
        return result ? result.toString() : ''
    } catch(err) {
        throw err
    }
}

try {
    console.log("Deploying to Vercel (Production)...")
    exec(`npx --yes vercel deploy --prod --token=${token} --yes`)
    console.log("Deployment successful!")
} catch(e) {
    console.error("Failed to deploy to Vercel.", e)
}
