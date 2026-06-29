#!/usr/bin/env node
/**
 * Deploy pullarao-appforge to Vercel.
 *
 * Usage:
 *   VERCEL_TOKEN=xxx GLM_API_KEY=xxx node scripts/deploy-to-vercel.js
 */

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const GLM_API_KEY = process.env.GLM_API_KEY
const PROJECT_ROOT = process.argv[2] || '/home/z/my-project'
const PROJECT_NAME = 'pullarao-appforge'

if (!VERCEL_TOKEN) { console.error('VERCEL_TOKEN env var required'); process.exit(1) }
if (!GLM_API_KEY) { console.error('GLM_API_KEY env var required'); process.exit(1) }

const VERCEL_API = 'https://api.vercel.com'
const AUTH_SECRET = 'bbf605ad2cec400a207d3d4a7e5b9fadbca1432e518a3587d084290638d7e868'
const APP_ENCRYPTION_KEY = '6ddc32800f44f4151608f621d9daed9660608ab44a3edca51b7426ae6245d7a6'

const SKIP = new Set([
  'node_modules', '.next', '.git', 'db', 'skills', 'download',
  '.zscripts', 'mini-services', 'examples', 'upload', 'android-app',
  'glm-ai-android', 'scripts', 'ci.db', 'ci-test.db', 'dev.log',
  'server.log', '.env', '.env.local', '.DS_Store', 'Thumbs.db',
  'coverage', 'out', 'build', 'dist', '.cache', '.bun',
])

async function walk(dir, base) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const full = join(dir, e.name)
    const rel = relative(base, full)
    if (e.isDirectory()) {
      out.push(...await walk(full, base))
    } else if (e.isFile()) {
      out.push(rel)
    }
  }
  return out
}

async function uploadFile(filePath, content) {
  const hash = createHash('sha1').update(content).digest('hex')
  const checkRes = await fetch(`${VERCEL_API}/v2/files/${hash}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  })
  if (checkRes.status === 200) return { file: filePath, sha: hash, cached: true }
  const upRes = await fetch(`${VERCEL_API}/v2/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'x-vercel-digest': hash,
    },
    body: content,
  })
  if (!upRes.ok && upRes.status !== 409) {
    const t = await upRes.text()
    throw new Error(`Upload ${filePath} failed: ${upRes.status} ${t.slice(0, 200)}`)
  }
  return { file: filePath, sha: hash, cached: false }
}

async function ensureProject() {
  const getRes = await fetch(`${VERCEL_API}/v8/projects/${PROJECT_NAME}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  })
  if (getRes.ok) {
    const p = await getRes.json()
    console.log(`  Existing project: ${p.name} (id: ${p.id})`)
    return p
  }
  const createRes = await fetch(`${VERCEL_API}/v9/projects`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PROJECT_NAME, framework: 'nextjs' }),
  })
  if (!createRes.ok) {
    const t = await createRes.text()
    throw new Error(`Create project failed: ${createRes.status} ${t}`)
  }
  const p = await createRes.json()
  console.log(`  Created project: ${p.name} (id: ${p.id})`)
  return p
}

async function setEnvVar(projectId, key, value, target = ['production', 'preview', 'development']) {
  const listRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  })
  const existing = await listRes.json()
  const existingEnv = (existing.envs || []).find(e => e.key === key)
  if (existingEnv) {
    await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${existingEnv.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, target }),
    })
    console.log(`  Updated env: ${key}`)
    return
  }
  const createRes = await fetch(`${VERCEL_API}/v10/projects/${projectId}/env`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, type: 'encrypted', target }),
  })
  if (!createRes.ok) {
    const t = await createRes.text()
    throw new Error(`Create env ${key} failed: ${createRes.status} ${t}`)
  }
  console.log(`  Created env: ${key}`)
}

async function createDeployment(project, files) {
  const payload = {
    name: PROJECT_NAME,
    project: project.id,
    target: 'production',
    files: files.map(f => ({ file: f.file, sha: f.sha })),
    projectSettings: {
      framework: 'nextjs',
      buildCommand: 'next build',
      outputDirectory: '.next',
      installCommand: 'bun install',
    },
  }
  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Create deployment failed: ${res.status} ${t.slice(0, 500)}`)
  }
  return await res.json()
}

async function pollDeployment(deploymentId) {
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 4000))
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    })
    const d = await res.json()
    const status = d.readyState
    console.log(`  [${i}] status: ${status}`)
    if (status === 'READY') return d
    if (status === 'ERROR') throw new Error(`Deployment failed: ${JSON.stringify(d.error || d).slice(0, 500)}`)
  }
  throw new Error('Deployment timed out')
}

async function main() {
  console.log('=== Deploying pullarao-appforge to Vercel ===\n')
  console.log('1. Collecting project files...')
  const filePaths = await walk(PROJECT_ROOT, PROJECT_ROOT)
  console.log(`   Found ${filePaths.length} files`)

  console.log('\n2. Uploading files to Vercel...')
  const uploaded = []
  let cached = 0
  for (let i = 0; i < filePaths.length; i++) {
    const rel = filePaths[i]
    const abs = join(PROJECT_ROOT, rel)
    const content = await readFile(abs)
    const result = await uploadFile(rel, content)
    uploaded.push(result)
    if (result.cached) cached++
    if (i % 30 === 0 || i === filePaths.length - 1) {
      console.log(`   [${i + 1}/${filePaths.length}] ${rel} ${result.cached ? '(cached)' : ''}`)
    }
  }
  console.log(`   Uploaded: ${uploaded.length - cached} new, ${cached} cached`)

  console.log('\n3. Ensuring Vercel project exists...')
  const project = await ensureProject()

  console.log('\n4. Setting environment variables...')
  await setEnvVar(project.id, 'GLM_API_KEY', GLM_API_KEY)
  await setEnvVar(project.id, 'GLM_MODEL', 'glm-5.2')
  await setEnvVar(project.id, 'GLM_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4/')
  await setEnvVar(project.id, 'AUTH_SECRET', AUTH_SECRET)
  await setEnvVar(project.id, 'APP_ENCRYPTION_KEY', APP_ENCRYPTION_KEY)
  await setEnvVar(project.id, 'NEXTAUTH_URL', `https://${PROJECT_NAME}.vercel.app`)
  await setEnvVar(project.id, 'DATABASE_URL', 'file:./db/appforge.db')

  console.log('\n5. Creating production deployment...')
  const dep = await createDeployment(project, uploaded)
  console.log(`   Deployment ID: ${dep.id}`)
  console.log(`   URL (provisional): ${dep.url}`)

  console.log('\n6. Waiting for build to complete...')
  const finalDep = await pollDeployment(dep.id)
  console.log(`\n✓ DEPLOYED!`)
  console.log(`  Live URL: https://${finalDep.url}`)
}

main().catch(e => {
  console.error('\n❌ Deploy failed:', e.message)
  process.exit(1)
})
