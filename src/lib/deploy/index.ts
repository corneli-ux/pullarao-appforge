/**
 * Deployment orchestration — pushes a generated web app to the user's
 * hosting provider via their API token.
 *
 * Supported providers:
 *  - VERCEL       : create deployment from uploaded files
 *  - NETLIFY      : create site + deploy via zip
 *  - CLOUDFLARE_PAGES : create project + deploy via direct upload API
 *  - GITHUB_PAGES : n/a in this file (handled via Actions workflow_dispatch)
 */

import { DeployProvider } from '@prisma/client'
import crypto from 'crypto'

export interface DeployResult {
  providerDeployId: string
  url: string
  logs?: string
}

export interface DeployContext {
  provider: DeployProvider
  token: string
  projectName: string
  files: Array<{ path: string; content: string }>
  framework?: string // 'nextjs' | 'static' | null
}

// ============================================================
//  VERCEL
// ============================================================

async function deployVercel(ctx: DeployContext): Promise<DeployResult> {
  // 1. Create or fetch project
  let projectId: string
  let teamId: string | undefined
  try {
    const me = await fetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${ctx.token}` },
    }).then(r => r.json())
    teamId = me?.user?.uid // user-level deployments work with the user UID
  } catch { /* ignore */ }

  const projectRes = await fetch(`https://api.vercel.com/v9/projects${teamId ? `?teamId=${teamId}` : ''}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: ctx.projectName,
      framework: ctx.framework === 'nextjs' ? 'nextjs' : null,
    }),
  })
  if (!projectRes.ok) {
    // Project might already exist — try to fetch it
    const existing = await fetch(`https://api.vercel.com/v8/projects/${ctx.projectName}${teamId ? `?teamId=${teamId}` : ''}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    })
    if (!existing.ok) {
      const e = await projectRes.text()
      throw new Error(`Vercel project create failed: ${e}`)
    }
    const ej = await existing.json()
    projectId = ej.id
  } else {
    const pj = await projectRes.json()
    projectId = pj.id
  }

  // 2. Upload files via /v2/files (each file is SHA-hashed)
  const fileHashes: string[] = []
  for (const f of ctx.files) {
    const content = Buffer.from(f.content, 'utf8')
    const hash = crypto.createHash('sha1').update(content).digest('hex')
    fileHashes.push(hash)
    await fetch(`https://api.vercel.com/v2/files?teamId=${teamId ?? ''}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/octet-stream',
        'x-vercel-digest': hash,
      },
      body: content,
    })
  }

  // 3. Create deployment
  const deployRes = await fetch(`https://api.vercel.com/v13/deployments?teamId=${teamId ?? ''}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: ctx.projectName,
      project: projectId,
      target: 'production',
      files: fileHashes.map(sha => ({ file: ctx.files.find(f => crypto.createHash('sha1').update(Buffer.from(f.content, 'utf8')).digest('hex') === sha)!.path, sha })),
    }),
  })
  if (!deployRes.ok) {
    const e = await deployRes.text()
    throw new Error(`Vercel deploy failed: ${e}`)
  }
  const dj = await deployRes.json()
  return {
    providerDeployId: dj.id,
    url: dj.url ? `https://${dj.url}` : `https://${ctx.projectName}.vercel.app`,
    logs: `Vercel deployment ${dj.id} queued`,
  }
}

// ============================================================
//  NETLIFY
// ============================================================

async function deployNetlify(ctx: DeployContext): Promise<DeployResult> {
  // 1. Create site (or fetch existing)
  let siteId: string
  const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ctx.projectName }),
  })
  if (!siteRes.ok) {
    // try fetch existing
    const existing = await fetch(`https://api.netlify.com/api/v1/sites?name=${ctx.projectName}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    })
    const ej = await existing.json()
    siteId = ej?.[0]?.id ?? (() => { throw new Error('Netlify site create failed') })()
  } else {
    const sj = await siteRes.json()
    siteId = sj.id
  }

  // 2. Build a zip of the files (Netlify deploy API expects a zip)
  //    We use a minimal in-memory zip — no external dep
  const zipBuffer = await buildZip(ctx.files)

  // 3. Create deploy
  const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/zip',
      'Content-Length': zipBuffer.length.toString(),
    },
    body: new Uint8Array(zipBuffer),
  })
  if (!deployRes.ok) {
    const e = await deployRes.text()
    throw new Error(`Netlify deploy failed: ${e}`)
  }
  const dj = await deployRes.json()
  return {
    providerDeployId: dj.id,
    url: dj.ssl_url || dj.url || `https://${ctx.projectName}.netlify.app`,
    logs: `Netlify deployment ${dj.id} queued`,
  }
}

// Minimal ZIP file builder (store-only, no compression) — enough for Netlify
async function buildZip(files: Array<{ path: string; content: string }>): Promise<Buffer> {
  // We use the system zip via child_process to avoid a JS zip dep.
  // Write files to a temp dir, zip it, read back, return.
  const fs = await import('fs/promises')
  const path = await import('path')
  const os = await import('os')
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'netlify-deploy-'))
  try {
    for (const f of files) {
      const filePath = path.join(tmpDir, f.path)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, f.content, 'utf8')
    }
    const zipPath = path.join(tmpDir, '..', `deploy-${Date.now()}.zip`)
    await execAsync(`cd "${tmpDir}" && zip -r -X "${zipPath}" .`)
    return await fs.readFile(zipPath)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ============================================================
//  CLOUDFLARE PAGES
// ============================================================

async function deployCloudflarePages(ctx: DeployContext): Promise<DeployResult> {
  const accountId = ctx.token.split(':')[0] // CF API tokens encode account in token prefix? No.
  // CF Pages API requires account_id query param. We need to fetch it from /accounts.
  const accountsRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
    headers: { Authorization: `Bearer ${ctx.token}` },
  })
  const accountsJson = await accountsRes.json()
  const accountId2 = accountsJson?.result?.[0]?.id
  if (!accountId2) throw new Error('Could not determine Cloudflare account ID')

  // 1. Create project
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId2}/pages/projects`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ctx.projectName }),
  }).catch(() => {}) // ignore if exists

  // 2. Create deployment with manifest of files
  const manifest: Record<string, { hash: string; size: number }> = {}
  const fileContents: Record<string, Buffer> = {}
  for (const f of ctx.files) {
    const content = Buffer.from(f.content, 'utf8')
    const hash = crypto.createHash('sha1').update(content).digest('hex')
    manifest[f.path] = { hash, size: content.length }
    fileContents[f.path] = content
  }

  const deployRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId2}/pages/projects/${ctx.projectName}/deployments`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest }),
    }
  )
  if (!deployRes.ok) {
    const e = await deployRes.text()
    throw new Error(`CF Pages deployment create failed: ${e}`)
  }
  const dj = await deployRes.json()

  // 3. Upload each file via the JWT-protected upload URL
  const uploadUrls = dj?.result?.jws?.upload_urls ?? []
  const paths = Object.keys(fileContents)
  await Promise.all(
    paths.map(async (p, i) => {
      const url = uploadUrls[i]
      if (!url) return
      await fetch(url, { method: 'PUT', body: new Uint8Array(fileContents[p]) })
    })
  )

  return {
    providerDeployId: dj?.result?.id ?? 'unknown',
    url: `https://${ctx.projectName}.pages.dev`,
    logs: `Cloudflare Pages deployment ${dj?.result?.id ?? 'queued'}`,
  }
}

// ============================================================
//  PUBLIC ENTRY POINT
// ============================================================

export async function deploy(ctx: DeployContext): Promise<DeployResult> {
  switch (ctx.provider) {
    case 'VERCEL': return deployVercel(ctx)
    case 'NETLIFY': return deployNetlify(ctx)
    case 'CLOUDFLARE_PAGES': return deployCloudflarePages(ctx)
    default: throw new Error(`Provider ${ctx.provider} not supported yet`)
  }
}
