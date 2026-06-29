import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { listWorkflowRuns } from '@/lib/github'

/**
 * GET /api/projects/[id]/actions
 * Returns the latest GitHub Actions workflow runs for this project's repo.
 * Requires the project to have been pushed (githubRepoOwner + Name set) and
 * the user to have a connected GitHub PAT.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const project = await db.project.findUnique({ where: { id } })
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!project.githubRepoOwner || !project.githubRepoName) {
    return NextResponse.json({ error: 'Project not pushed to GitHub yet', runs: [] }, { status: 400 })
  }

  const ghToken = await db.githubToken.findUnique({ where: { userId } })
  if (!ghToken) return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 })

  const pat = decrypt(ghToken.encryptedPat)
  try {
    const runs = await listWorkflowRuns(pat, project.githubRepoOwner, project.githubRepoName)
    const simplified = runs.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,           // queued | in_progress | completed
      conclusion: r.conclusion,   // success | failure | cancelled | null
      branch: r.head_branch,
      commit: r.head_sha?.slice(0, 7),
      message: r.head_commit?.message?.split('\n')[0]?.slice(0, 80),
      htmlUrl: r.html_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

    // Persist the latest run id on the project for quick dashboard display
    if (simplified[0]?.id) {
      await db.project.update({
        where: { id },
        data: { githubActionsRunId: String(simplified[0].id) },
      })
    }

    return NextResponse.json({ runs: simplified })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
