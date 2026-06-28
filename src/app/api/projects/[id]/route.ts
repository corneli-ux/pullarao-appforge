import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const project = await db.project.findUnique({
    where: { id },
    include: {
      files: { orderBy: { path: 'asc' } },
      chatSessions: { include: { messages: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 1 },
      deployments: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  })
  if (!project || project.userId !== userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ project })
}
