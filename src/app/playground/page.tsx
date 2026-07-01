'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  MessageSquare, Eye, ImageIcon, Video, Mic, Search, FileText, Loader2, ArrowLeft, Code2,
} from 'lucide-react'

/**
 * GLM Studio — a hands-on playground where students try every Pullarao 1
 * (GLM-5.2) capability directly, and see exactly which file/route handles it.
 *
 * WHY THIS PAGE EXISTS:
 * The project-generation flow (chat -> generate_project_files -> push to
 * GitHub -> deploy) is powerful but hides the individual AI capabilities
 * behind one conversation. This page exposes each capability as its own
 * small, readable request/response loop, with a note on the exact backend
 * file that handles it — so a student can open that file right after
 * clicking "Run" and see the whole path end to end.
 *
 * REQUEST FLOW (same shape for every capability on this page):
 *   Browser (this page)
 *     -> fetch('/api/glm/<capability>')      [Next.js API route, our server]
 *       -> fetch('open.bigmodel.cn/...')     [GLM-5.2 hosted API]
 *         <- JSON / audio / image bytes back
 *       <- normalized JSON back to the browser
 *     <- rendered in the UI below
 *
 * The API key never reaches the browser — it lives only in the server's
 * environment variables (GLM_API_KEY) and is used inside the route handlers
 * in src/app/api/glm/**. That's why every capability here requires sign-in:
 * the route checks getAuthenticatedUserId() before calling GLM at all.
 */

function ArchitectureNote({ route, children }: { route: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
      <Code2 className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <div className="font-mono text-[11px] mb-1">{route}</div>
        {children}
      </div>
    </div>
  )
}

export default function PlaygroundPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <div className="font-bold flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white text-sm">A</div>
            GLM Studio
          </div>
          <Badge variant="secondary" className="ml-auto">Pullarao 1 · glm-5.2</Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-1">GLM Studio</h1>
        <p className="text-gray-500 text-sm mb-6 max-w-2xl">
          Try every Pullarao 1 capability directly. Each tab shows the exact API route that
          handles it — open that file in the repo to see the full request, right after you run it here.
        </p>

        <Tabs defaultValue="chat">
          <TabsList className="grid grid-cols-4 md:grid-cols-7 h-auto mb-6">
            <TabsTrigger value="chat" className="gap-1"><MessageSquare className="h-3.5 w-3.5" /> Chat</TabsTrigger>
            <TabsTrigger value="vision" className="gap-1"><Eye className="h-3.5 w-3.5" /> Vision</TabsTrigger>
            <TabsTrigger value="image" className="gap-1"><ImageIcon className="h-3.5 w-3.5" /> Image</TabsTrigger>
            <TabsTrigger value="video" className="gap-1"><Video className="h-3.5 w-3.5" /> Video</TabsTrigger>
            <TabsTrigger value="speech" className="gap-1"><Mic className="h-3.5 w-3.5" /> Speech</TabsTrigger>
            <TabsTrigger value="search" className="gap-1"><Search className="h-3.5 w-3.5" /> Search</TabsTrigger>
            <TabsTrigger value="reader" className="gap-1"><FileText className="h-3.5 w-3.5" /> Reader</TabsTrigger>
          </TabsList>

          <TabsContent value="chat"><ChatPanel /></TabsContent>
          <TabsContent value="vision"><VisionPanel /></TabsContent>
          <TabsContent value="image"><ImagePanel /></TabsContent>
          <TabsContent value="video"><VideoPanel /></TabsContent>
          <TabsContent value="speech"><SpeechPanel /></TabsContent>
          <TabsContent value="search"><SearchPanel /></TabsContent>
          <TabsContent value="reader"><ReaderPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat — streaming SSE
// ---------------------------------------------------------------------------
function ChatPanel() {
  const [prompt, setPrompt] = useState('Explain how a hash map resolves collisions.')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null); setOutput('')
    try {
      const res = await fetch('/api/glm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          try {
            const evt = JSON.parse(data)
            if (evt.type === 'token') setOutput(o => o + evt.content)
            if (evt.type === 'error') setError(evt.message)
          } catch { /* partial */ }
        }
      }
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Streaming chat</CardTitle>
        <CardDescription>Real-time token-by-token responses over Server-Sent Events (SSE).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ArchitectureNote route="src/app/api/glm/chat/route.ts">
          Opens an SSE stream to GLM with <code>stream: true</code>, re-emits each token as its own
          <code> data: {'{'}type:&quot;token&quot;{'}'}</code> event. This page reads the stream with a
          <code> ReadableStream</code> reader — the same pattern used by the project-generation chat.
        </ArchitectureNote>
        <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} />
        <Button onClick={run} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Run</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {output && <pre className="whitespace-pre-wrap text-sm bg-gray-50 border rounded-md p-3">{output}</pre>}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------
function VisionPanel() {
  const [prompt, setPrompt] = useState('Describe this image and list any UI components you see.')
  const [imageUrl, setImageUrl] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null); setOutput('')
    try {
      const res = await fetch('/api/glm/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setOutput(data.text)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vision analysis</CardTitle>
        <CardDescription>Multimodal chat — an image URL plus a text prompt in one message.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ArchitectureNote route="src/app/api/glm/vision/route.ts">
          Calls the same <code>chat/completions</code> endpoint as regular chat, but the message
          <code> content</code> is an array mixing <code>{'{type:"text"}'}</code> and
          <code> {'{type:"image_url"}'}</code> blocks. This is how one model handles both text and images.
        </ArchitectureNote>
        <Label>Image URL</Label>
        <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://example.com/screenshot.png" />
        <Label>Prompt</Label>
        <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} />
        <Button onClick={run} disabled={loading || !imageUrl}>{loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Analyze</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {output && <pre className="whitespace-pre-wrap text-sm bg-gray-50 border rounded-md p-3">{output}</pre>}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------
function ImagePanel() {
  const [prompt, setPrompt] = useState('A minimalist logo for a college coding club, flat vector style')
  const [imgSrc, setImgSrc] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null); setImgSrc('')
    try {
      const res = await fetch('/api/glm/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, size: '1024x1024' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setImgSrc(`data:image/png;base64,${data.base64}`)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image generation</CardTitle>
        <CardDescription>Text-to-image. Returns base64-encoded image bytes in JSON.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ArchitectureNote route="src/app/api/glm/images/route.ts">
          One-shot POST to <code>images/generations</code> — no streaming, no polling. GLM returns
          the finished image as base64 directly in the response body.
        </ArchitectureNote>
        <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} />
        <Button onClick={run} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Generate</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {imgSrc && <img src={imgSrc} alt="Generated" className="rounded-md border max-w-xs" />}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Video generation (async task + poll)
// ---------------------------------------------------------------------------
function VideoPanel() {
  const [prompt, setPrompt] = useState('A drone shot flying over a university campus at sunrise')
  const [status, setStatus] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function run() {
    setLoading(true); setError(null); setVideoUrl(''); setStatus(null)
    try {
      const res = await fetch('/api/glm/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setStatus('PROCESSING')
      const taskId = data.taskId
      pollRef.current = setInterval(async () => {
        const pollRes = await fetch(`/api/glm/video?id=${taskId}`)
        const pollData = await pollRes.json()
        setStatus(pollData.status)
        if (pollData.status === 'SUCCESS' || pollData.videoUrl) {
          setVideoUrl(pollData.videoUrl)
          setLoading(false)
          if (pollRef.current) clearInterval(pollRef.current)
        }
        if (pollData.status === 'FAIL') {
          setError('Video generation failed')
          setLoading(false)
          if (pollRef.current) clearInterval(pollRef.current)
        }
      }, 4000)
    } catch (e: any) { setError(e.message); setLoading(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video generation</CardTitle>
        <CardDescription>Text-to-video. Asynchronous — create a task, then poll for the result.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ArchitectureNote route="src/app/api/glm/video/route.ts">
          <strong>POST</strong> creates a render task and returns a <code>taskId</code> immediately.
          <strong> GET ?id=</strong> polls <code>async-result/{'{id}'}</code> until status is
          <code> SUCCESS</code>. This page polls every 4s with <code>setInterval</code> — the same
          approach as <code>queryAsyncResult</code> in the Android app's <code>VideoRepositoryImpl</code>.
        </ArchitectureNote>
        <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} />
        <Button onClick={run} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Generate video</Button>
        {status && <p className="text-sm text-gray-500">Status: {status}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {videoUrl && <video src={videoUrl} controls className="rounded-md border max-w-sm" />}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Speech — TTS + ASR
// ---------------------------------------------------------------------------
function SpeechPanel() {
  const [text, setText] = useState('Welcome to Pullarao AppForge.')
  const [audioSrc, setAudioSrc] = useState('')
  const [ttsLoading, setTtsLoading] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [asrLoading, setAsrLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function runTts() {
    setTtsLoading(true); setError(null); setAudioSrc('')
    try {
      const res = await fetch('/api/glm/speech/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setAudioSrc(`data:audio/mp3;base64,${data.audioBase64}`)
    } catch (e: any) { setError(e.message) } finally { setTtsLoading(false) }
  }

  async function runAsr() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setAsrLoading(true); setError(null); setTranscript('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/glm/speech/asr', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setTranscript(data.text)
    } catch (e: any) { setError(e.message) } finally { setAsrLoading(false) }
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Text to speech</CardTitle>
          <CardDescription>Returns base64 audio bytes, played with an &lt;audio&gt; element.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ArchitectureNote route="src/app/api/glm/speech/tts/route.ts">
            GLM returns raw audio bytes (not JSON). The route reads them into a Buffer and
            re-encodes as base64 — same trick as the image route.
          </ArchitectureNote>
          <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} />
          <Button onClick={runTts} disabled={ttsLoading}>{ttsLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Speak</Button>
          {audioSrc && <audio src={audioSrc} controls className="w-full" />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Speech to text</CardTitle>
          <CardDescription>Upload an audio file, get back a transcript.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ArchitectureNote route="src/app/api/glm/speech/asr/route.ts">
            The only GLM route here using <code>multipart/form-data</code> instead of JSON —
            a <code>File</code> object goes straight into a <code>FormData</code> and is forwarded as-is.
          </ArchitectureNote>
          <Input ref={fileRef} type="file" accept="audio/*" />
          <Button onClick={runAsr} disabled={asrLoading}>{asrLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Transcribe</Button>
          {transcript && <p className="text-sm bg-gray-50 border rounded-md p-3">{transcript}</p>}
        </CardContent>
      </Card>
      {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------
function SearchPanel() {
  const [query, setQuery] = useState('latest Jetpack Compose release notes')
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null); setResults(null)
    try {
      const res = await fetch('/api/glm/websearch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setResults(data.results)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Web search</CardTitle>
        <CardDescription>GLM's built-in search tool — grounds answers in current results.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ArchitectureNote route="src/app/api/glm/websearch/route.ts">
          Calls the dedicated <code>tools/web-search</code> endpoint directly (not via chat function
          calling) — useful when you want raw search results back instead of a model-written answer.
        </ArchitectureNote>
        <Input value={query} onChange={e => setQuery(e.target.value)} />
        <Button onClick={run} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Search</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {results && <pre className="whitespace-pre-wrap text-xs bg-gray-50 border rounded-md p-3 max-h-80 overflow-auto">{JSON.stringify(results, null, 2)}</pre>}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page reader
// ---------------------------------------------------------------------------
function ReaderPanel() {
  const [url, setUrl] = useState('https://developer.android.com/jetpack/compose')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/glm/pagereader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setResult(data.result)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Page reader</CardTitle>
        <CardDescription>Extracts title, clean text, and token count from any URL.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ArchitectureNote route="src/app/api/glm/pagereader/route.ts">
          Same shape as web search — a direct call to <code>tools/page-reader</code> that hands back
          structured page content, useful for feeding docs into a generation prompt.
        </ArchitectureNote>
        <Input value={url} onChange={e => setUrl(e.target.value)} />
        <Button onClick={run} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Read page</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <pre className="whitespace-pre-wrap text-xs bg-gray-50 border rounded-md p-3 max-h-80 overflow-auto">{JSON.stringify(result, null, 2)}</pre>}
      </CardContent>
    </Card>
  )
}
