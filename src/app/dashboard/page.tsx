import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Github, ExternalLink, FileCode2, Clock } from 'lucide-react'

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  GENERATING: 'bg-amber-100 text-amber-700',
  GENERATED: 'bg-blue-100 text-blue-700',
  PUSHING: 'bg-amber-100 text-amber-700',
  PUSHED: 'bg-emerald-100 text-emerald-700',
  DEPLOYING: 'bg-amber-100 text-amber-700',
  DEPLOYED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
}

const APP_TYPE_LABEL: Record<string, string> = {
  ANDROID_APP: 'Android',
  WEB_APP: 'Web (Next.js)',
  STATIC_SITE: 'Static site',
  API_SERVICE: 'API service',
}

export default async function Dashboard() {
  const session = await auth()
  if (!session?.user) redirect('/login?callbackUrl=/dashboard')
  const userId = (session.user as any).id

  const [projects, ghToken, deployTargets] = await Promise.all([
    db.project.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { files: true } } },
    }),
    db.githubToken.findUnique({ where: { userId } }),
    db.deployTarget.findMany({ where: { userId } }),
  ])

  const ghConnected = !!ghToken
  const deployCount = deployTargets.length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white text-sm">A</div>
            AppForge
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/settings"><Button variant="ghost" size="sm">Settings</Button></Link>
            <Link href="/projects/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New project</Button></Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Your projects</h1>
            <p className="text-gray-500 text-sm">Welcome back, {session.user.name || session.user.email}</p>
          </div>
          <Link href="/projects/new"><Button><Plus className="h-4 w-4 mr-1" /> New project</Button></Link>
        </div>

        {/* Connection status banner */}
        {!ghConnected && (
          <Card className="mb-6 border-amber-200 bg-amber-50">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <Github className="h-5 w-5 text-amber-700" />
                <div>
                  <div className="font-medium text-amber-900">Connect your GitHub account</div>
                  <div className="text-sm text-amber-700">Required to push generated projects to your repositories.</div>
                </div>
              </div>
              <Link href="/settings"><Button size="sm" variant="outline">Connect</Button></Link>
            </CardContent>
          </Card>
        )}

        {projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FileCode2 className="h-12 w-12 text-gray-300 mb-3" />
              <h3 className="text-lg font-semibold mb-1">No projects yet</h3>
              <p className="text-sm text-gray-500 mb-4 max-w-md">Describe what you want to build and Pullarao 1 will generate a complete, deployable project for you.</p>
              <Link href="/projects/new"><Button><Plus className="h-4 w-4 mr-1" /> Create your first project</Button></Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{p.name}</CardTitle>
                        <CardDescription className="truncate">{APP_TYPE_LABEL[p.appType] || p.appType} · {p.framework}</CardDescription>
                      </div>
                      <Badge variant="secondary" className={STATUS_COLOR[p.status] || 'bg-gray-100'}>{p.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {p.description && <p className="text-sm text-gray-600 line-clamp-2 mb-3">{p.description}</p>}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><FileCode2 className="h-3 w-3" /> {p._count.files} files</span>
                      {p.githubRepoUrl && <span className="flex items-center gap-1"><Github className="h-3 w-3" /> repo</span>}
                      {p.deployUrl && <span className="flex items-center gap-1 text-emerald-600"><ExternalLink className="h-3 w-3" /> live</span>}
                      <span className="flex items-center gap-1 ml-auto"><Clock className="h-3 w-3" /> {new Date(p.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
