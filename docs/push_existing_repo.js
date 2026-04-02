const cp = require('child_process')
const fs = require('fs')

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
const token = env.GITHUB_TOKEN

if (!token) {
  console.error("No GITHUB_TOKEN found")
  process.exit(1)
}

const rootDir = 'd:\\project\\badminton'
const repoUrl = `https://senyingtang:${token}@github.com/senyingtang/badminton-drop-in.git`

const exec = (cmd) => {
    console.log(`> ${cmd}`)
    try {
        return cp.execSync(cmd, { cwd: rootDir, stdio: 'pipe' }).toString()
    } catch(err) {
        console.error(err.stdout ? err.stdout.toString() : err.stderr ? err.stderr.toString() : err.message)
        throw err
    }
}

try {
    try { exec('git remote remove origin') } catch(e){}
    exec(`git remote add origin ${repoUrl}`)
    exec('git fetch origin')
    // Reset to remote main if we just initialized, or pull
    // But since local is already committed with everything, and remote just has README.
    console.log("Merging remote...")
    try {
        exec('git pull origin main --allow-unrelated-histories --no-rebase -m "Merge remote-tracking branch origin/main"')
    } catch(e) {
        console.log("Pull failed, maybe conflicts or empty. Proceeding to force push.")
    }
    
    // Add any remaining uncommitted changes if needed
    try {
        exec('git add .')
        exec('git commit -m "Add badminton platform code"')
    } catch(e){} // ignore if nothing to commit
    
    console.log("Pushing to GitHub...")
    exec('git push -f origin main')
    console.log("Push successful!")
    
} catch(e) {
    console.error("Failed to push.", e)
}
