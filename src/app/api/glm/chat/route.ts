import { getAuthenticatedUserId } from '@/lib/auth-mobile'
import { db } from '@/lib/db'
import { chat, type ChatMessage, type ToolDefinition, type RawToolCall } from '@/lib/glm'
import { acquireGlmSlot } from '@/lib/concurrency'
import { generateAndroidApp, generateNextJsApp, generateStaticSite, suggestRepoName } from '@/lib/templates'

/**
 * General-purpose Pullarao 1 assistant chat — used by the standalone "Chat"
 * tab (not tied to any specific project).
 *
 * ARCHITECTURE NOTE (for students):
 * This used to be a raw passthrough: no system prompt, no tools, thinking
 * explicitly disabled. That meant GLM had no idea it was part of an
 * app-building platform and correctly (from its own isolated perspective)
 * said things like "I can't create repos or push code." The capability
 * genuinely existed elsewhere (project generation, project-scoped editing)
 * but was unreachable from this screen — the model wasn't being unhelpful,
 * it just hadn't been told what it could do or given the tools to do it.
 *
 * This version: always injects a real system prompt describing Pullarao 1's
 * actual capabilities, offers a real `create_project` tool that reuses the
 * SAME agentic generation pipeline as /api/projects (not a duplicate), and
 * forwards GLM's reasoning/thinking deltas as their own SSE event type
 * instead of dropping them.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 800 // generation via create_project can run long — see /api/projects for the same caveat about Vercel plan limits

const BASE_SYSTEM_PROMPT = `You are Pullarao 1, an AI assistant built into Pullarao AppForge — a platform where engineering students describe an app, website, or project in plain language and you build it for real.

You are not a plain chatbot with no capabilities. You have a real tool available in this conversation:

- create_project(name, description, appType) — actually generates a complete, real project (multiple files, a working codebase) using the exact same agentic build pipeline the platform's "New Project" flow uses. appType is one of ANDROID_APP, WEB_APP, STATIC_SITE. Once you call this and it completes, the files exist for real in the student's account — they can open the Projects tab to review, push to GitHub, deploy, or keep chatting with you to edit it further.

When a student asks you to build/create/make an app, website, or project, call create_project — don't just say you can't, and don't just hand them a script to run themselves. If they ask a general question, just answer normally. If they ask about capabilities you genuinely don't have (e.g. you can't act outside this platform, can't access accounts you weren't given, can't guarantee external services), say so honestly — the point is to use the real tools you do have, not to overclaim beyond them either.`

function orchestrationTools(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'create_project',
        description: 'Generate a complete, real project — multiple files, a working codebase — using the platform\'s agentic build pipeline. Use this whenever the student asks you to build/create/make something.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short project name' },
            description: { type: 'string', description: 'What to build — as much detail as the student gave you' },
            appType: { type: 'string', enum: ['ANDROID_APP', 'WEB_APP', 'STATIC_SITE'] },
          },
          required: ['name', 'description', 'appType'],
        },
      },
    },
  ]
}

async function executeCreateProject(userId: string, args: Record<string, any>): Promise<string> {
  const name = String(args.name || 'Untitled project').slice(0, 80)
  const description = String(args.description || '').slice(0, 4000)
  const appType = ['ANDROID_APP', 'WEB_APP', 'STATIC_SITE'].includes(args.appType) ? args.appType : 'WEB_APP'
  if (description.length < 10) return 'Error: need more detail about what to build before calling create_project.'

  const slug = (suggestRepoName(name) || suggestRepoName(description) || 'project').slice(0, 40)
  const project = await db.project.create({
    data: {
      userId, name, slug, description, appType,
      framework: appType === 'ANDROID_APP' ? 'android-native' : appType === 'WEB_APP' ? 'nextjs' : 'static-html',
      status: 'GENERATING',
      glmModel: 'Pullarao 1',
    },
  })

  const onFile = async (f: { path: string; content: string; language: string }) => {
    await db.projectFile.upsert({
      where: { projectId_path: { projectId: project.id, path: f.path } },
      create: { projectId: project.id, path: f.path, content: f.content, language: f.language, size: f.content.length },
      update: { content: f.content, language: f.language, size: f.content.length },
    })
    const count = await db.projectFile.count({ where: { projectId: project.id } })
    await db.project.update({ where: { id: project.id }, data: { fileCount: count } })
  }

  try {
    const generated =
      appType === 'ANDROID_APP' ? await generateAndroidApp(description, `com.user.${slug.replace(/-/g, '')}`, onFile)
      : appType === 'WEB_APP' ? await generateNextJsApp(description, onFile)
      : await generateStaticSite(description, onFile)

    await db.project.update({
      where: { id: project.id },
      data: { status: 'GENERATED', fileCount: generated.files.length, generationLog: generated.summary, framework: generated.framework },
    })
    return `Created project "${name}" (id: ${project.id}) — ${generated.files.length} files generated. ${generated.summary} Tell the student to open the Projects tab to review, push to GitHub, or deploy.`
  } catch (e: any) {
    await db.project.update({ where: { id: project.id }, data: { status: 'FAILED', generationLog: e.message } })
    return `Error: generation failed for "${name}": ${e.message}`
  }
}

export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Sign in to use Pullarao 1' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => null)
  if (!body?.messages?.length) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Merge: our system prompt always wins the "what can you do" framing;
  // any client-supplied system message (e.g. a student's custom persona
  // in Settings) is appended as additional context rather than replacing
  // the capability description entirely.
  const clientMessages: ChatMessage[] = body.messages
  const clientSystem = clientMessages.find(m => m.role === 'system')
  const conversation = clientMessages.filter(m => m.role !== 'system')
  const systemContent = clientSystem?.content
    ? `${BASE_SYSTEM_PROMPT}\n\nAdditional instructions from the student's settings:\n${clientSystem.content}`
    : BASE_SYSTEM_PROMPT

  const messages: ChatMessage[] = [{ role: 'system', content: systemContent }, ...conversation]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`))
      let release: (() => Promise<void>) | null = null
      try {
        release = await acquireGlmSlot(`glmchat:${userId}`)
        const MAX_TURNS = 6
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const { content, reasoning, toolCalls } = await chat(messages, {
            temperature: body.temperature ?? 0.7,
            maxTokens: body.max_tokens ?? 4096,
            tools: orchestrationTools(),
            thinking: true,
          })

          if (reasoning) send({ type: 'thinking', content: reasoning })

          if (toolCalls.length === 0) {
            // Stream this final answer out token-ish (single chunk — the
            // underlying chat() call is non-streaming so we can inspect
            // tool_calls cleanly; still delivered as a 'token' event so
            // the client's existing rendering path just works).
            send({ type: 'token', content })
            send({ type: 'done' })
            return
          }

          const rawToolCalls: RawToolCall[] = toolCalls.map(tc => ({
            id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }))
          messages.push({ role: 'assistant', content: content || '', tool_calls: rawToolCalls })

          for (const tc of toolCalls) {
            send({ type: 'action', name: tc.name })
            if (tc.name === 'create_project') {
              const result = await executeCreateProject(userId, tc.arguments)
              messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
            } else {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: `Unknown tool ${tc.name}` })
            }
          }
        }
        send({ type: 'token', content: 'That took more steps than expected — check the Projects tab for what was created so far.' })
        send({ type: 'done' })
      } catch (e: any) {
        send({ type: 'error', message: e.message })
      } finally {
        if (release) await release()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
