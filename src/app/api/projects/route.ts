import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  generateAndroidApp,
  generateNextJsApp,
  generateStaticSite,
  suggestRepoName,
} from '@/lib/templates'

const schema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(10).max(4000),
  appType: z.enum(['ANDROID_APP', 'WEB_APP', 'STATIC_SITE']),
  framework: z.string().optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  const { name, description, appType, framework } = parsed.data

  const slug = (suggestRepoName(name) || suggestRepoName(description) || 'project').slice(0, 40)

  // Create project in GENERATING state
  const project = await db.project.create({
    data: {
      userId,
      name,
      slug,
      description,
      appType,
      framework: framework ?? (appType === 'ANDROID_APP' ? 'android-native' : appType === 'WEB_APP' ? 'nextjs' : 'static-html'),
      status: 'GENERATING',
      glmModel: 'Pullarao 1',
    },
  })

  // Kick off generation (long-running — done in-band for simplicity, but should be a queue in prod)
  try {
    const generated =
      appType === 'ANDROID_APP' ? await generateAndroidApp(description, `com.user.${slug.replace(/-/g, '')}`)
      : appType === 'WEB_APP' ? await generateNextJsApp(description)
      : await generateStaticSite(description)

    // Persist files
    await db.projectFile.createMany({
      data: generated.files.map(f => ({
        projectId: project.id,
        path: f.path,
        content: f.content,
        language: f.language,
        size: f.content.length,
      })),
    })
    await db.project.update({
      where: { id: project.id },
      data: { status: 'GENERATED', fileCount: generated.files.length, generationLog: generated.summary, framework: generated.framework },
    })
    return NextResponse.json({ projectId: project.id, files: generated.files.length, summary: generated.summary })
  } catch (e: any) {
    await db.project.update({ where: { id: project.id }, data: { status: 'FAILED', generationLog: e.message } })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const projects = await db.project.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, name: true, slug: true, appType: true, status: true,
      framework: true, githubRepoUrl: true, deployUrl: true,
      fileCount: true, createdAt: true, updatedAt: true,
    },
  })
  return NextResponse.json({ projects })
}
