'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Github, Plus, Trash2, Loader2, CheckCircle2, Cloud, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

interface GithubInfo {
  connected: boolean
  githubLogin?: string
  avatarUrl?: string
  patScopes?: string
  validatedAt?: string
}

interface DeployTargetInfo {
  id: string
  provider: string
  label: string | null
  validatedAt: string | null
}

const PROVIDERS = [
  { id: 'VERCEL', label: 'Vercel', desc: 'Deploy Next.js & static apps', helpUrl: 'https://vercel.com/account/tokens' },
  { id: 'NETLIFY', label: 'Netlify', desc: 'Deploy static & JAMstack sites', helpUrl: 'https://app.netlify.com/user/applications#personal-access-tokens' },
  { id: 'CLOUDFLARE_PAGES', label: 'Cloudflare Pages', desc: 'Deploy on Cloudflare\'s edge network', helpUrl: 'https://dash.cloudflare.com/profile/api-tokens' },
]

export default function SettingsPage() {
  const [gh, setGh] = useState<GithubInfo | null>(null)
  const [targets, setTargets] = useState<DeployTargetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [pat, setPat] = useState('')
  const [savingGh, setSavingGh] = useState(false)

  // Deploy target form
  const [deployProvider, setDeployProvider] = useState('VERCEL')
  const [deployToken, setDeployToken] = useState('')
  const [savingDeploy, setSavingDeploy] = useState(false)

  async function load() {
    setLoading(true)
    const [ghRes, depRes] = await Promise.all([
      fetch('/api/settings/github'),
      fetch('/api/settings/deploy'),
    ])
    if (ghRes.ok) setGh(await ghRes.json())
    if (depRes.ok) {
      const d = await depRes.json()
      setTargets(d.targets || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveGithub() {
    if (!pat.trim()) return
    setSavingGh(true)
    try {
      const res = await fetch('/api/settings/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pat }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`Connected to GitHub as @${data.githubLogin}`)
      setPat('')
      await load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingGh(false)
    }
  }

  async function disconnectGithub() {
    if (!confirm('Disconnect your GitHub account? Existing pushed repos will remain in your GitHub.')) return
    await fetch('/api/settings/github', { method: 'DELETE' })
    toast.success('GitHub disconnected')
    await load()
  }

  async function saveDeploy() {
    if (!deployToken.trim()) return
    setSavingDeploy(true)
    try {
      const res = await fetch('/api/settings/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: deployProvider, token: deployToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`${deployProvider} connected`)
      setDeployToken('')
      await load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingDeploy(false)
    }
  }

  async function removeDeploy(provider: string) {
    if (!confirm(`Remove ${provider}?`)) return
    await fetch(`/api/settings/deploy?provider=${provider}`, { method: 'DELETE' })
    toast.success(`${provider} removed`)
    await load()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900">← Dashboard</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-gray-500 text-sm">Connect your GitHub and deployment accounts. All tokens are encrypted at rest with AES-256-GCM.</p>
        </div>

        {/* GitHub */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Github className="h-5 w-5" /> GitHub</CardTitle>
            <CardDescription>Required to push generated projects to your repositories.</CardDescription>
          </CardHeader>
          <CardContent>
            {gh?.connected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  {gh.avatarUrl && <img src={gh.avatarUrl} alt="" className="h-10 w-10 rounded-full" />}
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      @{gh.githubLogin}
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="text-xs text-gray-500">Scopes: {gh.patScopes || 'unknown'}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={disconnectGithub}><Trash2 className="h-3 w-3 mr-1" /> Disconnect</Button>
                </div>
                <div className="text-xs text-gray-500 p-3 rounded-md bg-amber-50 border border-amber-200">
                  Tip: Create a PAT with <code>repo</code> and <code>workflow</code> scopes at{' '}
                  <a href="https://github.com/settings/tokens/new?scopes=repo,workflow" target="_blank" rel="noreferrer" className="underline">github.com/settings/tokens</a>.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="pat">Personal Access Token</Label>
                  <Input id="pat" type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_..." />
                </div>
                <Button onClick={saveGithub} disabled={savingGh || !pat.trim()}>
                  {savingGh ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                  Connect GitHub
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deploy targets */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cloud className="h-5 w-5" /> Deployment targets</CardTitle>
            <CardDescription>Connect hosting providers so you can deploy generated web apps.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {targets.length > 0 && (
              <div className="space-y-2">
                {targets.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="font-medium">{t.provider}</span>
                      {t.label && <Badge variant="outline">{t.label}</Badge>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => removeDeploy(t.provider)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t pt-4">
              <div className="text-sm font-medium mb-2">Add a deploy target</div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDeployProvider(p.id)}
                    className={`text-left p-2 rounded border-2 transition-all ${deployProvider === p.id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200'}`}
                  >
                    <div className="font-medium text-xs">{p.label}</div>
                    <div className="text-xs text-gray-500">{p.desc}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="deployToken">API token</Label>
                <Input id="deployToken" type="password" value={deployToken} onChange={(e) => setDeployToken(e.target.value)} placeholder="Paste your token" />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Get a token:{' '}
                <a href={PROVIDERS.find(p => p.id === deployProvider)?.helpUrl} target="_blank" rel="noreferrer" className="underline flex items-center gap-1 inline-flex">
                  {PROVIDERS.find(p => p.id === deployProvider)?.helpUrl} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <Button onClick={saveDeploy} disabled={savingDeploy || !deployToken.trim()} className="mt-3">
                {savingDeploy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Connect {PROVIDERS.find(p => p.id === deployProvider)?.label}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
