import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { deploy as deployApp } from '@/lib/deploy'
import { DeployProvider } from '@prisma/client'

const schema = z.object({
  projectId: z.string(),
  provider: z.nativeEnum(DeployProvider),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { projectId, provider } = parsed.data

  const [project, deployTarget] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, include: { files: true } }),
    db.deployTarget.findUnique({ where: { userId_provider: { userId, provider } } }),
  ])
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (project.appType === 'ANDROID_APP') return NextResponse.json({ error: 'Android apps are deployed via GitHub Actions, not a hosting provider' }, { status: 400 })
  if (!deployTarget) return NextResponse.json({ error: `Connect your ${provider} account first` }, { status: 400 })
  if (project.files.length === 0) return NextResponse.json({ error: 'Generate files first' }, { status: 400 })

  const token = decrypt(deployTarget.encryptedToken)
  await db.project.update({ where: { id: projectId }, data: { status: 'DEPLOYING' } })

  // Create a deployment record
  const deployment = await db.deployment.create({
    data: {
      projectId,
      deployTargetId: deployTarget.id,
      provider,
      status: 'PENDING',
    },
  })

  try {
    const result = await deployApp({
      provider,
      token,
      projectName: project.slug,
      files: project.files.map(f => ({ path: f.path, content: f.content })),
      framework: project.framework ?? undefined,
    })

    await db.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'READY',
        providerDeployId: result.providerDeployId,
        url: result.url,
        logs: result.logs,
        completedAt: new Date(),
      },
    })
    await db.project.update({
      where: { id: projectId },
      data: { status: 'DEPLOYED', deployUrl: result.url, lastDeployedAt: new Date() },
    })

    return NextResponse.json({ ok: true, url: result.url, deployId: result.providerDeployId })
  } catch (e: any) {
    await db.deployment.update({
      where: { id: deployment.id },
      data: { status: 'ERROR', errorMessage: e.message, completedAt: new Date() },
    })
    await db.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
