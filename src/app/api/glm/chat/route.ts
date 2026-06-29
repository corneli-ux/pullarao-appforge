import { getAuthenticatedUserId } from '@/lib/auth-mobile'

/**
 * Platform-side GLM proxy — students sign in, we forward their chat to GLM-5.2
 * using the platform's API key (stored in .env as GLM_API_KEY).
 *
 * We call GLM directly via fetch (not the z-ai-web-dev-sdk) because the SDK
 * reads from a .z-ai-config file which doesn't work on Vercel serverless.
 *
 * Endpoint: POST /api/glm/chat
 * Auth: NextAuth session cookie OR Bearer token (mobile)
 * Body: { messages: [{role, content}], temperature?, max_tokens? }
 * Returns: SSE stream of { type: 'token'|'done'|'error', content?|message? }
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel hobby plan max

export async function POST(req: Request) {
  // 1. Authenticate
  const userId = await getAuthenticatedUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Sign in to use Pullarao 1' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // 2. Check platform config
  const apiKey = process.env.GLM_API_KEY
  const baseUrl = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'
  const model = process.env.GLM_MODEL || 'glm-5.2'
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Platform not configured — admin must set GLM_API_KEY' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  // 3. Parse request
  const body = await req.json().catch(() => null)
  if (!body?.messages?.length) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // 4. Call GLM with stream=true, forward SSE tokens to the client
  const glmResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.max_tokens ?? 4096,
      stream: true,
      thinking: { type: 'disabled' },
    }),
  })

  if (!glmResponse.ok) {
    const errText = await glmResponse.text()
    return new Response(JSON.stringify({ error: `GLM API error ${glmResponse.status}: ${errText.slice(0, 300)}` }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }

  // 5. Stream the SSE response through
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const reader = glmResponse.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
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
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: delta.content })}\n\n`))
              }
            } catch { /* partial JSON */ }
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
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
