import Link from 'next/link'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Github, Rocket, Sparkles, Cloud, Shield, Cpu, ArrowRight, CheckCircle2 } from 'lucide-react'

export default async function Home() {
  const session = await auth()
  const isLoggedIn = !!session?.user

  // If logged in, show a quick dashboard preview
  let projectCount = 0
  if (isLoggedIn) {
    projectCount = await db.project.count({ where: { userId: (session.user as any).id } })
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-amber-50">
      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 border-b border-emerald-100">
        <div className="max-w-6xl mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="bg-gradient-to-r from-emerald-700 to-amber-600 bg-clip-text text-transparent">AppForge</span>
            <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-mono text-emerald-700">Pullarao 1</span>
          </Link>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <>
                <Link href="/dashboard"><Button variant="ghost">Dashboard {projectCount > 0 && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">{projectCount}</span>}</Button></Link>
                <Link href="/projects/new"><Button>New project</Button></Link>
              </>
            ) : (
              <>
                <Link href="/login"><Button variant="ghost">Sign in</Button></Link>
                <Link href="/register"><Button>Get started</Button></Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-medium text-emerald-800 mb-6">
          <Cpu className="h-4 w-4" />
          Powered by open-source Pullarao 1
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-gray-900 mb-6">
          Describe an app.
          <br />
          <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-amber-600 bg-clip-text text-transparent">Pullarao 1 builds it.</span>
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-gray-600 mb-8">
          A multi-user platform that generates complete Android &amp; web apps, pushes them to your own GitHub, and deploys to Vercel, Netlify, or Cloudflare — all driven by your tokens, all in minutes.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/register">
            <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Start building free <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">Sign in</Button>
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-3xl font-bold text-center mb-12">From prompt to production in 4 steps</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { icon: Sparkles, title: '1. Describe', desc: 'Tell Pullarao 1 what you want — an Android app, a Next.js site, a static page. It generates the full source.' },
            { icon: Github, title: '2. Push to GitHub', desc: 'Connect your PAT. AppForge creates a repo in your account and pushes every file via the Contents API.' },
            { icon: Rocket, title: '3. CI builds it', desc: 'Generated GitHub Actions workflows compile your APK or run your web build automatically on push.' },
            { icon: Cloud, title: '4. Deploy', desc: 'One click to ship to Vercel, Netlify, or Cloudflare Pages using your deploy token. Live URL in seconds.' },
          ].map((step, i) => (
            <Card key={i} className="border-emerald-100">
              <CardHeader>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 mb-2">
                  <step.icon className="h-6 w-6" />
                </div>
                <CardTitle className="text-lg">{step.title}</CardTitle>
                <CardDescription>{step.desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="bg-white border-t border-emerald-100 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Built for builders</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <Shield className="h-8 w-8 text-emerald-600 mb-2" />
                <CardTitle>Your tokens, your repos</CardTitle>
                <CardDescription>
                  GitHub PATs and deploy-provider tokens are AES-256-GCM encrypted at rest. We never see your code or your secrets in plaintext after the API call.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Cpu className="h-8 w-8 text-emerald-600 mb-2" />
                <CardTitle>Open-source Pullarao 1</CardTitle>
                <CardDescription>
                  Every generation routes through the open-source Pullarao 1 model. Self-host the model and point AppForge at your own endpoint for full sovereignty.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mb-2" />
                <CardTitle>Real, buildable projects</CardTitle>
                <CardDescription>
                  No toy demos. Generated Android projects compile in CI. Generated web apps pass TypeScript checks. Push and watch the green checkmark appear.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-emerald-100 bg-white py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div>© 2026 Pullarao AppForge · Built on Pullarao 1 open source</div>
          <div className="flex gap-4">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/settings">Settings</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
