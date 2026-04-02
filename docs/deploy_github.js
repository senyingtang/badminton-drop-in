const https = require('https')
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

function fetchGithub(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'NodeJS',
        'Accept': 'application/vnd.github.v3+json'
      }
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data))
        } else {
          reject(new Error(`GitHub API Error: ${res.statusCode} ${data}`))
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  try {
    // 1. Get user info
    const user = await fetchGithub('/user')
    const owner = user.login
    console.log(`Authenticated as GitHub user: ${owner}`)

    const repoName = 'badminton-platform-app'

    // 2. Check if repo exists
    let repoUrl = ''
    try {
      const repo = await fetchGithub(`/repos/${owner}/${repoName}`)
      console.log(`Repo exists: ${repo.html_url}`)
      repoUrl = `https://${token}@github.com/${owner}/${repoName}.git`
    } catch (e) {
      if (e.message.includes('404')) {
        // Create repo
        console.log(`Creating repo ${repoName}...`)
        const newRepo = await fetchGithub('/user/repos', 'POST', {
          name: repoName,
          private: true,
        })
        console.log(`Repo created: ${newRepo.html_url}`)
        repoUrl = `https://${token}@github.com/${owner}/${repoName}.git`
      } else {
        throw e
      }
    }

    // 3. Init git and push
    const rootDir = 'd:\\project\\badminton'
    console.log(`Initializing git in ${rootDir} ...`)
    
    // safe exec
    const exec = (cmd) => {
        try {
            return cp.execSync(cmd, { cwd: rootDir, stdio: 'pipe' }).toString()
        } catch(err) {
            return err.stdout ? err.stdout.toString() : err.message
        }
    }

    exec('git init')
    // Create gitignore if not exists
    if (!fs.existsSync(`${rootDir}\\.gitignore`)) {
        fs.writeFileSync(`${rootDir}\\.gitignore`, `node_modules/\n.env*\n.next/\n!web/.env.local`)
    }
    exec('git add .')
    exec('git commit -m "Initial commit for badminton platform phase 1-7"')
    
    // set branch to main
    try{ exec('git branch -M main') }catch(e){}
    
    // add remote
    try{ exec('git remote remove origin') }catch(e){}
    try{ exec(`git remote add origin ${repoUrl}`) }catch(e){}
    
    console.log('Pushing to GitHub...')
    const pushOutput = cp.execSync('git push -u origin main', { cwd: rootDir, shell: true })
    console.log('Push successful!')
    
    console.log('--- REPO OWNER ---')
    console.log(owner)

  } catch(e) {
    console.error(e)
  }
}

main()
