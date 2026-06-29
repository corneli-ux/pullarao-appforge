'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Smartphone, Globe, FileText, Loader2, Sparkles } from 'lucide-react'

type AppType = 'ANDROID_APP' | 'WEB_APP' | 'STATIC_SITE'

const PRESETS: { type: AppType; title: string; description: string }[] = [
  { type: 'WEB_APP', title: 'SaaS landing page', description: 'A modern SaaS landing page with hero, features, pricing, and CTA. Includes a working contact form.' },
  { type: 'ANDROID_APP', title: 'Task manager Android app', description: 'A to-do list app with categories, reminders, and Material 3 design. Uses Room for local persistence.' },
  { type: 'STATIC_SITE', title: 'Personal portfolio', description: 'A sleek one-page portfolio with bio, projects grid, and contact links. Dark mode support.' },
]

export default function NewProjectPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [appType, setAppType] = useState<AppType>('WEB_APP')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !description.trim()) {
      setError('Name and description are required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, appType }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Generation failed')
      }
      const data = await res.json()
      router.push(`/projects/${data.projectId}`)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900">← Back to dashboard</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">Create a new project</h1>
          <p className="text-gray-500 text-sm">Pullarao 1 will generate a complete, buildable project from your description.</p>
        </div>

        <form onSubmit={onSubmit}>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">1. What are you building?</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-3">
              {([
                { type: 'ANDROID_APP', label: 'Android app', desc: 'Kotlin + Compose + Hilt + Room', icon: Smartphone },
                { type: 'WEB_APP', label: 'Next.js web app', desc: 'TypeScript + Tailwind + shadcn', icon: Globe },
                { type: 'STATIC_SITE', label: 'Static site', desc: 'HTML + CSS + vanilla JS', icon: FileText },
              ] as const).map(opt => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setAppType(opt.type)}
                  className={`text-left p-4 rounded-lg border-2 transition-all ${
                    appType === opt.type ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <opt.icon className={`h-6 w-6 mb-2 ${appType === opt.type ? 'text-emerald-600' : 'text-gray-400'}`} />
                  <div className="font-medium text-sm">{opt.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">2. Describe your project</CardTitle>
              <CardDescription>The more detail you give, the better Pullarao 1 can match your intent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Project name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My awesome app" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">What should it do?</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Build a habit tracker with daily streaks, reminders, and a calendar view. Include user accounts and a dashboard showing progress over time."
                  rows={6}
                  required
                />
                <p className="text-xs text-gray-500">{description.length} / 4000 characters</p>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Quick starts:</div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setAppType(p.type); setName(p.title); setDescription(p.description) }}
                      className="text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{error}</div>
          )}

          <div className="flex justify-end gap-3">
            <Link href="/dashboard"><Button type="button" variant="ghost">Cancel</Button></Link>
            <Button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Pullarao 1 is generating…</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Generate with Pullarao 1</>
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
