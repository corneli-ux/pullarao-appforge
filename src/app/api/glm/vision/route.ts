import { NextResponse } from 'next/server'
import { getAuthenticatedUserId } from '@/lib/auth-mobile'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * Vision analysis proxy — student uploads an image URL, platform calls
 * GLM-5.2 vision endpoint with platform's key, returns analysis text.
 */

let _zaiPromise: Promise<ZAI> | null = null
function getClient() { if (!_zaiPromise) _zaiPromise = ZAI.create(); return _zaiPromise }

export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!process.env.GLM_API_KEY) return NextResponse.json({ error: 'Platform not configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  if (!body?.prompt || !body?.imageUrl) {
    return NextResponse.json({ error: 'prompt and imageUrl required' }, { status: 400 })
  }

  try {
    const client = await getClient()
    const response = await client.chat.completions.createVision({
      model: process.env.GLM_MODEL || 'glm-5.2',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: body.prompt },
          { type: 'image_url', image_url: { url: body.imageUrl } },
        ],
      } as any],
      thinking: { type: 'disabled' },
    } as any)
    const text = (response.choices?.[0]?.message as any)?.content ?? ''
    return NextResponse.json({ text })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
