import { Sandbox } from '@vercel/sandbox'

/**
 * Real code execution — Vercel Sandbox (Firecracker microVMs, same
 * infrastructure Vercel's own build system runs on).
 *
 * WHY THIS FILE EXISTS:
 * Project generation and chat-driven edits could write files but never
 * verify them — nothing ever actually ran the generated code. This module
 * is what closes that gap: it spins up a real, isolated Linux VM, installs
 * dependencies, and runs a real build. If it fails, the actual compiler/
 * bundler error comes back and can be fed to Pullarao 1 to fix — the same
 * "write, run, read the error, fix" loop Claude Code and GLM-5.2's agentic
 * mode are built around.
 *
 * In production on Vercel, this authenticates automatically via OIDC — no
 * API key to manage, and usage bills against the same Vercel account this
 * app already runs on. Locally, `vercel link && vercel env pull` gives you
 * a dev token; see https://vercel.com/docs/sandbox for details.
 *
 * SCOPE: wired up for Next.js (WEB_APP) projects only. STATIC_SITE has no
 * build step to verify. ANDROID_APP is intentionally NOT sandboxed here —
 * a full Gradle + Android SDK environment is heavy and slow to provision
 * per-generation, and GitHub Actions already builds a real debug APK after
 * push, which is the verification path already in place for Android.
 */

export interface FileInput {
  path: string
  content: string
}

export interface BuildCheckResult {
  success: boolean
  /** Tail of the combined stdout+stderr — enough to see the actual error, not the whole log. */
  output: string
}

const INSTALL_TIMEOUT_MS = 3 * 60 * 1000
const BUILD_TIMEOUT_MS = 3 * 60 * 1000
const OUTPUT_TAIL_CHARS = 4000

async function commandOutput(cmd: { stdout(): Promise<string>; stderr(): Promise<string> }): Promise<string> {
  const [out, err] = await Promise.all([cmd.stdout(), cmd.stderr()])
  return `${out}\n${err}`.trim().slice(-OUTPUT_TAIL_CHARS)
}

/**
 * Writes a Next.js project into a fresh sandbox and runs `npm install && npm run build`.
 * Returns whether it succeeded and the real compiler/build output either way.
 */
export async function checkNextJsBuild(files: FileInput[]): Promise<BuildCheckResult> {
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: 5 * 60 * 1000,
    resources: { vcpus: 2 },
  })
  try {
    await sandbox.writeFiles(files.map(f => ({ path: f.path, content: f.content })))

    const install = await sandbox.runCommand('npm', ['install', '--no-audit', '--no-fund'], { timeoutMs: INSTALL_TIMEOUT_MS })
    if (install.exitCode !== 0) {
      return { success: false, output: `npm install failed:\n${await commandOutput(install)}` }
    }

    const build = await sandbox.runCommand('npm', ['run', 'build'], { timeoutMs: BUILD_TIMEOUT_MS })
    if (build.exitCode !== 0) {
      return { success: false, output: `npm run build failed:\n${await commandOutput(build)}` }
    }

    return { success: true, output: 'Build succeeded.' }
  } finally {
    await sandbox.stop().catch(() => { /* best-effort cleanup */ })
  }
}

const PREVIEW_TIMEOUT_MS = 45 * 60 * 1000 // Hobby plan max; Pro/Enterprise can go up to 24h

/**
 * Starts (or resumes) a persistent, named sandbox per project and runs the
 * Next.js dev server inside it, detached, exposed on port 3000.
 *
 * NOTE: this always re-runs `npm install` on each call for simplicity and
 * correctness (new/changed dependencies are picked up reliably) — an easy
 * future optimization is skipping install when package.json is unchanged
 * since the last call, since Vercel Sandbox persists the filesystem
 * (including node_modules) across calls to the same named sandbox.
 */
export async function startDevPreview(projectId: string, files: FileInput[]): Promise<{ url: string }> {
  const sandbox = await Sandbox.getOrCreate({
    name: `preview-${projectId}`,
    runtime: 'node24',
    timeout: PREVIEW_TIMEOUT_MS,
    ports: [3000],
    resources: { vcpus: 2 },
  })

  await sandbox.writeFiles(files.map(f => ({ path: f.path, content: f.content })))

  const install = await sandbox.runCommand('npm', ['install', '--no-audit', '--no-fund'], { timeoutMs: INSTALL_TIMEOUT_MS })
  if (install.exitCode !== 0) {
    throw new Error(`npm install failed:\n${await commandOutput(install)}`)
  }

  // Detached: this needs to keep running as a background dev server, not
  // block until it exits (it never does under normal operation).
  await sandbox.runCommand({ cmd: 'npm', args: ['run', 'dev'], detached: true })

  // Give Next.js a moment to bind the port before handing back the URL.
  await new Promise(resolve => setTimeout(resolve, 3000))

  return { url: sandbox.domain(3000) }
}

export async function stopDevPreview(projectId: string): Promise<void> {
  try {
    const sandbox = await Sandbox.get({ name: `preview-${projectId}`, resume: false })
    await sandbox.stop()
  } catch {
    // Already stopped or never started — nothing to do.
  }
}
