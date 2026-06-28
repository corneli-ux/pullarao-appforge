/**
 * GitHub orchestration — uses the user's PAT to:
 *   - validate the token and fetch their login
 *   - create a new repository
 *   - push multiple files via the Contents API (commits one per batch)
 *   - trigger GitHub Actions (the workflow runs automatically on push)
 *
 * Uses the REST API directly — no `octokit` dependency.
 */

const GITHUB_API = 'https://api.github.com'

export interface GitHubUser {
  login: string
  id: number
  avatarUrl: string
  name: string | null
}

export interface CreateRepoInput {
  name: string
  description?: string
  private: boolean
  autoInit?: boolean
}

export interface GitHubRepo {
  id: number
  name: string
  fullName: string
  url: string
  cloneUrl: string
  htmlUrl: string
  defaultBranch: string
}

export interface PushFile {
  path: string
  content: string // base64-encoded by this function
  message?: string
}

async function gh<T = any>(
  pat: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'glm-appforge',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = `GitHub API ${method} ${path} → ${res.status}`
    try {
      const j = JSON.parse(text)
      if (j.message) msg += `: ${j.message}`
    } catch { msg += `: ${text.slice(0, 200)}` }
    throw new Error(msg)
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export async function validateToken(pat: string): Promise<GitHubUser> {
  const u = await gh<any>(pat, 'GET', '/user')
  return {
    login: u.login,
    id: u.id,
    avatarUrl: u.avatar_url,
    name: u.name ?? null,
  }
}

export async function listScopes(pat: string): Promise<string[]> {
  // HEAD /user returns X-OAuth-Scopes for classic PATs
  const res = await fetch(`${GITHUB_API}/user`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${pat}`, 'User-Agent': 'glm-appforge' },
  })
  const scopes = res.headers.get('x-oauth-scopes') || ''
  return scopes.split(',').map(s => s.trim()).filter(Boolean)
}

export async function createRepo(pat: string, input: CreateRepoInput): Promise<GitHubRepo> {
  const r = await gh<any>(pat, 'POST', '/user/repos', {
    name: input.name,
    description: input.description ?? '',
    private: input.private,
    auto_init: input.autoInit ?? true,
    gitignore_template: input.name.endsWith('-android') ? 'Android' : 'Node',
  })
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    url: r.url,
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch ?? 'main',
  }
}

/**
 * Push multiple files in parallel batches. Each file is committed individually
 * via PUT /repos/:owner/:repo/contents/:path — simpler than git tree API and
 * works fine for typical generated projects (<200 files).
 */
export async function pushFiles(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  files: PushFile[]
): Promise<{ pushed: number; failed: Array<{ path: string; error: string }> }> {
  const failed: Array<{ path: string; error: string }> = []
  let pushed = 0

  // Process in batches of 8 to avoid rate-limit bursts
  const BATCH = 8
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH)
    await Promise.all(
      batch.map(async (f) => {
        try {
          // Get current SHA if file exists (so we update instead of 409)
          let sha: string | undefined
          try {
            const existing = await gh<any>(pat, 'GET', `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}?ref=${branch}`)
            sha = existing?.sha
          } catch { /* file doesn't exist yet — fine */ }

          const content = Buffer.from(f.content, 'utf8').toString('base64')
          await gh(pat, 'PUT', `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}`, {
            message: f.message ?? `feat: add ${f.path}`,
            content,
            branch,
            ...(sha ? { sha } : {}),
          })
          pushed++
        } catch (e: any) {
          failed.push({ path: f.path, error: e.message })
        }
      })
    )
  }
  return { pushed, failed }
}

export async function triggerWorkflow(
  pat: string,
  owner: string,
  repo: string,
  workflowId: string,
  ref: string = 'main'
): Promise<void> {
  await gh(pat, 'POST', `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
    ref,
  })
}

export async function listWorkflowRuns(pat: string, owner: string, repo: string) {
  const r = await gh<any>(pat, 'GET', `/repos/${owner}/${repo}/actions/runs?per_page=5`)
  return r.workflow_runs ?? []
}

export async function getRepo(pat: string, owner: string, repo: string): Promise<GitHubRepo | null> {
  try {
    const r = await gh<any>(pat, 'GET', `/repos/${owner}/${repo}`)
    return {
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      url: r.url,
      cloneUrl: r.clone_url,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch,
    }
  } catch {
    return null
  }
}
