import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GLM video generation proxy — text-to-video.
 *
 * ARCHITECTURE NOTE (for students):
 * Video generation is ASYNC on the GLM API — unlike chat or images, you don't
 * get the video back in one request. The flow is:
 *
 *   1. POST /api/glm/video          -> platform calls GLM `videos/generations`
 *                                       GLM immediately returns a `task_id`
 *                                       (the video isn't ready yet — it's
 *                                       rendering on GLM's servers)
 *   2. GET  /api/glm/video?id=...   -> platform calls GLM `async-result/{id}`
 *                                       repeatedly ("polling") until the
 *                                       status flips from PROCESSING to
 *                                       SUCCESS (or FAIL)
 *
 * This "create task, then poll for result" pattern is common for any AI
 * capability that's too slow to hold an HTTP connection open for (video,
 * large batch jobs, fine-tuning). The Android app implements the exact same
 * two-call pattern in `GlmApi.kt` (`createVideoTask` + `queryAsyncResult`).
 */

// POST /api/glm/video — kick off a video generation task, returns a task id
export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  if (!apiKey) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GLM_VIDEO_MODEL || 'cogvideox-3',
      prompt: body.prompt,
      quality: body.quality || 'speed',
      size: body.size || '1920x1080',
      fps: body.fps || 30,
      duration: body.duration || 5,
      with_audio: body.withAudio ?? false,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    return NextResponse.json({ error: `GLM error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const data = await res.json()
  const taskId = data.id || data.task_id
  if (!taskId) return NextResponse.json({ error: 'No task id returned' }, { status: 502 })
  return NextResponse.json({ taskId, status: 'PROCESSING' })
}

// GET /api/glm/video?id=<taskId> — poll for the result of a video task
export async function GET(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  if (!apiKey) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const taskId = searchParams.get('id')
  if (!taskId) return NextResponse.json({ error: 'id query param required' }, { status: 400 })

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/async-result/${taskId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const t = await res.text()
    return NextResponse.json({ error: `GLM error ${res.status}: ${t.slice(0, 300)}` }, { status: 502 })
  }
  const data = await res.json()
  const status = data.task_status || data.status || 'PROCESSING'
  const videoUrl = data.video_result?.[0]?.url
  return NextResponse.json({ taskId, status, videoUrl })
}
