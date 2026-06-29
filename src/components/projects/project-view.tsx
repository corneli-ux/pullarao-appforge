'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Github, Send, Loader2, FileCode2, Rocket, ExternalLink, Sparkles, ChevronRight, CheckCircle2, XCircle, Cloud, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

interface ProjectFile { id: string; path: string; content: string; language: string | null }
interface ChatMsg { id: string; role: string; content: string }
interface Deployment { id: string; provider: string; status: string; url: string | null; createdAt: string }
interface WorkflowRun {
  id: number; name: string; status: string; conclusion: string | null;
  branch: string; commit: string | null; message: string | null;
  htmlUrl: string; createdAt: string; updatedAt: string
}
interface Project {
  id: string; name: string; slug: string; description: string | null; appType: string; framework: string | null;
  status: string; glmModel: string; githubRepoUrl: string | null; githubRepoOwner: string | null; githubRepoName: string | null;
  githubActionsRunId: string | null; deployUrl: string | null; fileCount: number; generationLog: string | null;
  files: ProjectFile[]; chatSessions: { messages: ChatMsg[] }[]; deployments: Deployment[]
}

interface Props {
  project: Project
  githubConnected: boolean
  deployTargets: string[]
}

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

export function ProjectView({ project: initialProject, githubConnected, deployTargets }: Props) {
  const [project, setProject] = useState(initialProject)
  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'deploy'>('chat')
  const [chatInput, setChatInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [messages, setMessages] = useState<ChatMsg[]>(initialProject.chatSessions[0]?.messages || [])
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(initialProject.files[0] || null)
  const [pushing, setPushing] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // Fetch GitHub Actions runs when the project has been pushed
  async function refreshRuns() {
    if (!project.githubRepoOwner || !project.githubRepoName) return
    setLoadingRuns(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/actions`)
      if (res.ok) {
        const data = await res.json()
        setWorkflowRuns(data.runs || [])
      }
    } catch {
      /* swallow — non-critical */
    } finally {
      setLoadingRuns(false)
    }
  }

  useEffect(() => {
    if (project.githubRepoUrl) refreshRuns()
    // Auto-poll every 30s if any run is still in progress
    const hasInProgress = workflowRuns.some(r => r.status === 'queued' || r.status === 'in_progress')
    if (!hasInProgress) return
    const interval = setInterval(refreshRuns, 30_000)
    return () => clearInterval(interval)
  }, [project.githubRepoUrl, project.githubActionsRunId])

  async function refreshProject() {
    const res = await fetch(`/api/projects/${project.id}`, { method: 'GET' })
    if (res.ok) {
      const data = await res.json()
      setProject(data.project)
    }
  }

  async function sendChat() {
    if (!chatInput.trim() || streaming) return
    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: chatInput }
    setMessages(prev => [...prev, userMsg])
    const sentText = chatInput
    setChatInput('')
    setStreaming(true)
    setStreamingText('')

    let accumulated = ''
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, message: sentText }),
      })
      if (!res.ok) throw new Error('Chat request failed')
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          try {
            const evt = JSON.parse(data)
            if (evt.type === 'token') {
              accumulated += evt.content
              setStreamingText(accumulated)
            }
            if (evt.type === 'done') {
              if (accumulated) {
                setMessages(prev => [...prev, { id: Date.now().toString() + 'a', role: 'assistant', content: accumulated }])
              }
              setStreamingText('')
            }
            if (evt.type === 'error') toast.error(evt.message)
          } catch {}
        }
      }
      // If the stream closed without a 'done' event but we have content, persist it
      if (accumulated && !messages.some(m => m.content === accumulated)) {
        setMessages(prev => prev.some(m => m.content === accumulated) ? prev : [...prev, { id: Date.now().toString() + 'b', role: 'assistant', content: accumulated }])
        setStreamingText('')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setStreaming(false)
      setStreamingText('')
    }
  }

  async function pushToGithub() {
    if (!githubConnected) {
      toast.error('Connect your GitHub account in Settings first')
      return
    }
    setPushing(true)
    try {
      const res = await fetch('/api/projects/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Push failed')
      toast.success(data.message || `Pushed ${data.pushed} files to GitHub`)
      await refreshProject()
      // Give GitHub Actions a moment to register the run, then fetch
      setTimeout(refreshRuns, 3000)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPushing(false)
    }
  }

  async function deploy(provider: string) {
    setDeploying(true)
    try {
      const res = await fetch('/api/projects/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, provider }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Deploy failed')
      toast.success(`Deployed to ${data.url}`)
      await refreshProject()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeploying(false)
    }
  }

  // Group files by directory for tree view
  const fileTree = buildFileTree(project.files)

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold truncate">{project.name}</h1>
            <Badge className={STATUS_COLOR[project.status] || 'bg-gray-100'}>{project.status}</Badge>
          </div>
          <p className="text-gray-500 text-sm">{project.appType.replace(/_/g, ' ')} · {project.framework} · {project.files.length} files · {project.glmModel}</p>
          {project.description && <p className="text-gray-600 text-sm mt-2">{project.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {project.githubRepoUrl && (
            <a href={project.githubRepoUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm"><Github className="h-4 w-4 mr-1" /> View repo</Button>
            </a>
          )}
          {project.deployUrl && (
            <a href={project.deployUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm"><ExternalLink className="h-4 w-4 mr-1" /> Live</Button>
            </a>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button onClick={pushToGithub} disabled={pushing || project.files.length === 0} size="sm">
          {pushing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Github className="h-4 w-4 mr-1" />}
          {pushing ? 'Pushing…' : project.githubRepoUrl ? 'Re-push to GitHub' : 'Push to GitHub'}
        </Button>
        {project.appType !== 'ANDROID_APP' && (
          deployTargets.length > 0 ? (
            deployTargets.map(p => (
              <Button key={p} onClick={() => deploy(p)} disabled={deploying} size="sm" variant="outline">
                {deploying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Rocket className="h-4 w-4 mr-1" />}
                Deploy to {p}
              </Button>
            ))
          ) : (
            <a href="/settings"><Button size="sm" variant="outline"><Cloud className="h-4 w-4 mr-1" /> Connect deploy target</Button></a>
          )
        )}
      </div>

      {/* GitHub Actions CI status */}
      {project.githubRepoUrl && (
        <Card className="mb-6">
          <CardContent className="py-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Github className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">CI status</span>
                {workflowRuns.length === 0 && !loadingRuns && (
                  <span className="text-xs text-gray-500">No workflow runs yet</span>
                )}
                {workflowRuns.slice(0, 3).map(run => (
                  <a key={run.id} href={run.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border hover:bg-gray-50">
                    {run.status === 'completed' && run.conclusion === 'success' && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                    {run.status === 'completed' && run.conclusion === 'failure' && <XCircle className="h-3 w-3 text-red-600" />}
                    {run.status === 'completed' && run.conclusion === 'cancelled' && <XCircle className="h-3 w-3 text-gray-400" />}
                    {(run.status === 'queued' || run.status === 'in_progress') && <Loader2 className="h-3 w-3 animate-spin text-amber-600" />}
                    <span className="font-medium truncate max-w-[180px]">{run.name}</span>
                    {run.commit && <span className="text-gray-400 font-mono">{run.commit}</span>}
                    <span className="text-gray-400">{run.branch}</span>
                  </a>
                ))}
              </div>
              <Button onClick={refreshRuns} variant="ghost" size="sm" disabled={loadingRuns}>
                <RefreshCw className={`h-3 w-3 mr-1 ${loadingRuns ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="chat"><Sparkles className="h-3 w-3 mr-1" /> Chat with Pullarao 1</TabsTrigger>
          <TabsTrigger value="files"><FileCode2 className="h-3 w-3 mr-1" /> Files ({project.files.length})</TabsTrigger>
          <TabsTrigger value="deploy"><Rocket className="h-3 w-3 mr-1" /> Deployments ({project.deployments.length})</TabsTrigger>
        </TabsList>

        {/* Chat tab */}
        <TabsContent value="chat" className="mt-4">
          <Card className="h-[600px] flex flex-col">
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full p-4">
                <div className="space-y-3">
                  {messages.length === 0 && !streaming && (
                    <div className="text-center text-gray-400 py-12">
                      <Sparkles className="h-8 w-8 mx-auto mb-2" />
                      <p className="text-sm">Ask Pullarao 1 to refine, explain, or extend your project.</p>
                    </div>
                  )}
                  {messages.map(m => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg p-3 text-sm whitespace-pre-wrap ${
                        m.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-900'
                      }`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {streaming && (
                    <div className="flex justify-start">
                      <div className="max-w-[80%] rounded-lg p-3 text-sm bg-gray-100">
                        {streamingText || <Loader2 className="h-3 w-3 animate-spin" />}
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
            <div className="border-t p-3 flex gap-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask Pullarao 1 anything about your project…"
                rows={2}
                disabled={streaming}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
              />
              <Button onClick={sendChat} disabled={streaming || !chatInput.trim()} size="icon" className="h-auto">
                {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </Card>
        </TabsContent>

        {/* Files tab */}
        <TabsContent value="files" className="mt-4">
          <Card className="h-[600px]">
            <CardContent className="grid grid-cols-12 h-full p-0">
              <div className="col-span-4 border-r overflow-auto">
                <FileTreeNode node={fileTree} depth={0} selectedPath={selectedFile?.path || ''} onSelect={(f) => setSelectedFile(f)} />
              </div>
              <div className="col-span-8 overflow-auto">
                {selectedFile ? (
                  <div>
                    <div className="px-3 py-2 border-b text-xs font-mono text-gray-500 flex items-center justify-between">
                      <span>{selectedFile.path}</span>
                      <Badge variant="outline">{selectedFile.language || 'text'}</Badge>
                    </div>
                    <pre className="p-3 text-xs font-mono overflow-auto whitespace-pre-wrap break-all bg-gray-50">{selectedFile.content}</pre>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">Select a file</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deployments tab */}
        <TabsContent value="deploy" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Deployment history</CardTitle></CardHeader>
            <CardContent>
              {project.deployments.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No deployments yet. Click a deploy button above.</p>
              ) : (
                <div className="space-y-2">
                  {project.deployments.map(d => (
                    <div key={d.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        {d.status === 'READY' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : d.status === 'ERROR' ? <XCircle className="h-5 w-5 text-red-600" /> : <Loader2 className="h-5 w-5 animate-spin text-amber-600" />}
                        <div>
                          <div className="font-medium text-sm">{d.provider}</div>
                          <div className="text-xs text-gray-500">{new Date(d.createdAt).toLocaleString()}</div>
                        </div>
                      </div>
                      {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-sm text-emerald-600 hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" /> {d.url.replace(/^https?:\/\//, '')}</a>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  )
}

// ---- File tree helpers ----

interface TreeNode {
  name: string
  path: string
  file?: ProjectFile
  children: Record<string, TreeNode>
}

function buildFileTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: {} }
  for (const f of files) {
    const parts = f.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const path = parts.slice(0, i + 1).join('/')
      if (!cur.children[part]) {
        cur.children[part] = { name: part, path, children: {} }
      }
      cur = cur.children[part]
      if (i === parts.length - 1) cur.file = f
    }
  }
  return root
}

function FileTreeNode({ node, depth, selectedPath, onSelect }: { node: TreeNode; depth: number; selectedPath: string; onSelect: (f: ProjectFile) => void }) {
  return (
    <div>
      {Object.values(node.children)
        .sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name))
        .map(child => (
          <div key={child.path}>
            <button
              className={`w-full text-left text-xs py-1 px-2 hover:bg-gray-100 flex items-center gap-1 ${selectedPath === child.path ? 'bg-emerald-50 text-emerald-700' : ''}`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              onClick={() => child.file && onSelect(child.file)}
            >
              {child.file ? (
                <FileCode2 className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
              )}
              <span className="truncate">{child.name}</span>
            </button>
            {!child.file && <FileTreeNode node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />}
          </div>
        ))}
    </div>
  )
}
