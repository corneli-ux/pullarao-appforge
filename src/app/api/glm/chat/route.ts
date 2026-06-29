import { getAuthenticatedUserId } from '@/lib/auth-mobile'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * Platform-side GLM proxy.
 *
 * Why this exists:
 *  - Students sign up with email + password (no API key)
 *  - The platform holds the GLM API key in .env as GLM_API_KEY
 *  - This endpoint authenticates the student, then forwards their
 *    request to GLM using the platform's key
 *  - The student never sees the key
 *
 * This endpoint streams SSE tokens back from GLM-5.2 to the caller
 * (the Android app or the in-browser chat).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lazily-initialized ZAI client — reuses the platform's key from env
let _zaiPromise: Promise<ZAI> | null = null
function getClient(): Promise<ZAI> {
  if (_zaiPromise) return _zaiPromise
  _zaiPromise = ZAI.create()
  return _zaiPromise
}

export async function POST(req: Request) {
  // 1. Authenticate — student must be signed in (cookie session OR mobile bearer)
  const userId = await getAuthenticatedUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Sign in to use Pullarao 1' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 2. Verify the platform has GLM_API_KEY configured
  if (!process.env.GLM_API_KEY) {
    return new Response(JSON.stringify({ error: 'Platform not configured — admin must set GLM_API_KEY' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 3. Parse the student's request
  const body = await req.json().catch(() => null)
  if (!body?.messages?.length) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const model = process.env.GLM_MODEL || 'glm-5.2'
  const client = await getClient()

  // 4. Stream tokens back as SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let full = ''
      try {
        const glmStream: ReadableStream<Uint8Array> = await client.chat.completions.create({
          model,
          messages: body.messages,
          temperature: body.temperature ?? 0.7,
          max_tokens: body.max_tokens ?? 4096,
          stream: true,
          thinking: { type: 'disabled' },
        } as any)

        const reader = glmStream.getReader()
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
            if (data === '[DONE]') continue
            try {
              const chunk = JSON.parse(data)
              const delta = chunk.choices?.[0]?.delta
              if (delta?.content) {
                full += delta.content
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: delta.content })}\n\n`))
              }
            } catch {
              /* partial JSON — wait for more */
            }
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', usage: { user: userId } })}\n\n`))
      } catch (e: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
