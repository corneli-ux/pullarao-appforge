import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { startDevPreview, stopDevPreview } from '@/lib/sandbox'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /api/projects/[id]/preview — start (or resume) a real, live dev
 * server for this project in a Vercel Sandbox and return its public URL.
 *
 * This replaces "preview by deploying" for Next.js projects: instead of
 * needing the student to already have a Vercel/Netlify/Cloudflare account
 * connected, this spins up an actual `npm run dev` inside an isolated VM
 * and exposes it directly — no deploy, no third-party token required.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, include: { files: true } })
  if (!project || project.userId !== userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.appType !== 'WEB_APP') return NextResponse.json({ error: 'Live preview is only available for Next.js web app projects' }, { status: 400 })
  if (project.files.length === 0) return NextResponse.json({ error: 'Generate files first' }, { status: 400 })

  try {
    const { url } = await startDevPreview(
      project.id,
      project.files.map(f => ({ path: f.path, content: f.content }))
    )
    return NextResponse.json({ url })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/** DELETE /api/projects/[id]/preview — stop the running preview sandbox to free resources. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const project = await db.project.findUnique({ where: { id } })
  if (!project || project.userId !== userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await stopDevPreview(project.id)
  return NextResponse.json({ ok: true })
}
