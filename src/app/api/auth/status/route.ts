import { NextResponse } from 'next/server'
import { isGithubOAuthEnabled } from '@/lib/auth'

export async function GET() {
  return NextResponse.json({ githubOAuth: isGithubOAuthEnabled })
}
