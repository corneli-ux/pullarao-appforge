import { auth } from '@/lib/auth'
import { verifyMobileToken } from '@/app/api/mobile/login/route'
import ZAI from 'z-ai-web-dev-sdk'

/**
 * Auth helper for GLM proxy endpoints — accepts either:
 *   1. NextAuth session cookie (from the web app — same browser)
 *   2. Bearer token in Authorization header (from the Android app)
 * Returns the user id if authenticated, null otherwise.
 */

export async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  // Try Bearer token first (mobile app)
  const authHeader = req.headers.get('authorization') || ''
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = await verifyMobileToken(token)
    if (payload?.sub) return payload.sub
  }

  // Fall back to NextAuth session (web app)
  const session = await auth()
  if (session?.user) {
    const id = (session.user as any).id
    if (id) return id
  }

  return null
}
