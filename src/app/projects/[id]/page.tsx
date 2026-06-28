import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ProjectView } from '@/components/projects/project-view'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect('/login?callbackUrl=/projects/' + id)
  const userId = (session.user as any).id

  const project = await db.project.findUnique({
    where: { id },
    include: {
      files: { orderBy: { path: 'asc' } },
      chatSessions: { include: { messages: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 1 },
      deployments: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  })

  if (!project || project.userId !== userId) redirect('/dashboard')

  const [ghToken, deployTargets] = await Promise.all([
    db.githubToken.findUnique({ where: { userId } }),
    db.deployTarget.findMany({ where: { userId } }),
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900">← Dashboard</Link>
          <Link href="/projects/new"><button className="text-sm text-emerald-700 hover:underline">New project</button></Link>
        </div>
      </header>
      <ProjectView
        project={JSON.parse(JSON.stringify(project))}
        githubConnected={!!ghToken}
        deployTargets={deployTargets.map(t => t.provider)}
      />
    </div>
  )
}
