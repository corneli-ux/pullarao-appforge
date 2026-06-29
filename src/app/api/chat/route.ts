import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { streamChat, ORCHESTRATION_TOOLS, type ChatMessage } from '@/lib/glm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/chat
 * Body: { projectId, message, sessionId? }
 * Returns: text/event-stream of Pullarao 1 tokens.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json().catch(() => null)
  if (!body?.projectId || !body?.message) {
    return new Response('Missing projectId or message', { status: 400 })
  }
  const { projectId, message, sessionId } = body

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { chatSessions: { include: { messages: { orderBy: { createdAt: 'asc' } } } } },
  })
  if (!project || project.userId !== userId) {
    return new Response('Project not found', { status: 404 })
  }

  // Get or create chat session
  let chatSession = project.chatSessions.find(s => s.id === sessionId)
  if (!chatSession) {
    chatSession = await db.chatSession.create({
      data: { projectId, userId, title: message.slice(0, 60), messages: { create: [] } },
      include: { messages: true },
    })
  }

  // Persist the user message
  await db.chatMessage.create({
    data: { sessionId: chatSession.id, role: 'user', content: message },
  })

  // Build the conversation for GLM
  const systemPrompt = `You are Pullarao 1, an AI pair programmer helping the user build "${project.name}".
Project type: ${project.appType}
Framework: ${project.framework}
Description: ${project.description}
Status: ${project.status}

You can:
- Discuss the design and architecture
- Suggest improvements
- Offer to regenerate files (the user can click "Regenerate" in the UI)
- Offer to push to GitHub (user clicks "Push to GitHub")
- Offer to deploy (user clicks "Deploy")

Be concise, technical, and helpful. Use markdown for code snippets.`

  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...chatSession.messages.slice(-10).map(m => ({ role: m.role as any, content: m.content })),
    { role: 'user', content: message },
  ]

  // Stream tokens via SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let full = ''
      try {
        await streamChat(
          history,
          {
            onToken: (tok) => {
              full += tok
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: tok })}\n\n`))
            },
            onDone: (finalText) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            },
          },
          { temperature: 0.7, maxTokens: 2048, tools: ORCHESTRATION_TOOLS }
        )
        // Persist assistant message
        await db.chatMessage.create({
          data: { sessionId: chatSession!.id, role: 'assistant', content: full },
        })
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
