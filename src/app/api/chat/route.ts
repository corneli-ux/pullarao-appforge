import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { chat, type ChatMessage, type ToolDefinition, type RawToolCall } from '@/lib/glm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/chat — the project's "edit with Pullarao 1" chat.
 *
 * ARCHITECTURE NOTE (for students):
 * Earlier this passed `tools: ORCHESTRATION_TOOLS` to the model but never
 * implemented an `onToolCall` handler — so if GLM ever decided to call one
 * of those tools, the call was silently dropped and nothing happened. The
 * chat could describe changes but never actually make them.
 *
 * This version gives GLM real, executable tools scoped to THIS project's
 * files: read_file, str_replace_in_file (a targeted patch, not a full
 * rewrite), write_file (create or fully replace a file), and delete_file.
 * It's a real agentic loop, same shape as project generation: call a tool,
 * we execute it against the database and report the result back, repeat,
 * until GLM responds with plain text instead of a tool call (its "I'm
 * done" signal) or a turn limit is hit.
 *
 * We do NOT send full file contents up front — only a path list — so a
 * project with 40 files doesn't cost 40 files' worth of tokens on every
 * single chat message. GLM calls read_file for the specific files it
 * actually needs to look at before editing them, which is both cheaper
 * and closer to how a human developer approaches an unfamiliar codebase.
 */

const MAX_EDIT_TURNS = 20

function editTools(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the current full contents of one file in the project.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Exact repo-relative path' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'str_replace_in_file',
        description:
          'Make a targeted edit to an existing file by replacing one exact, unique occurrence of old_str with new_str. ' +
          'Prefer this over write_file for small changes — it is cheaper and safer than regenerating the whole file. ' +
          'old_str must match the current file content exactly and appear exactly once; if it does not, you will get an error and should read_file again or adjust.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_str: { type: 'string', description: 'Exact text to find (must be unique in the file)' },
            new_str: { type: 'string', description: 'Text to replace it with' },
          },
          required: ['path', 'old_str', 'new_str'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create a new file, or fully overwrite an existing one. Use str_replace_in_file instead for small edits to existing files.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            language: { type: 'string' },
          },
          required: ['path', 'content', 'language'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file from the project.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
  ]
}

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
    include: {
      chatSessions: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
      files: { select: { path: true } },
    },
  })
  if (!project || project.userId !== userId) {
    return new Response('Project not found', { status: 404 })
  }

  let chatSession = project.chatSessions.find(s => s.id === sessionId)
  if (!chatSession) {
    chatSession = await db.chatSession.create({
      data: { projectId, userId, title: message.slice(0, 60), messages: { create: [] } },
      include: { messages: true },
    })
  }

  await db.chatMessage.create({ data: { sessionId: chatSession.id, role: 'user', content: message } })

  const fileList = project.files.map(f => f.path).join('\n') || '(no files yet)'
  const systemPrompt = `You are Pullarao 1, an AI pair programmer helping the user build "${project.name}".
Project type: ${project.appType}
Framework: ${project.framework}
Description: ${project.description}
Status: ${project.status}

Current files in this project:
${fileList}

You can discuss the design, AND you can actually make changes using tools:
- read_file — look at a file's current content before editing it
- str_replace_in_file — make a targeted edit (prefer this for small changes)
- write_file — create a new file or fully replace an existing one
- delete_file — remove a file

Always read_file before editing a file you haven't already read in this conversation — don't guess at its current content. When you're done making changes (or if the user just asked a question with no changes needed), respond with plain text summarizing what you did — that ends the turn. The user still has to click "Push to GitHub" and "Deploy" themselves; you don't trigger those.`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...chatSession.messages.slice(-16).map(m => ({ role: m.role as any, content: m.content })),
    { role: 'user', content: message },
  ]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`))
      try {
        let finalText = ''
        for (let turn = 0; turn < MAX_EDIT_TURNS; turn++) {
          const { content, toolCalls } = await chat(messages, {
            temperature: 0.4,
            maxTokens: 4096,
            tools: editTools(),
          })

          if (toolCalls.length === 0) {
            finalText = content
            send({ type: 'token', content })
            break
          }

          const rawToolCalls: RawToolCall[] = toolCalls.map(tc => ({
            id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }))
          messages.push({ role: 'assistant', content: content || '', tool_calls: rawToolCalls })

          for (const tc of toolCalls) {
            send({ type: 'action', name: tc.name, path: tc.arguments.path })
            const result = await executeTool(projectId, tc.name, tc.arguments)
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
          }

          if (turn === MAX_EDIT_TURNS - 1) {
            finalText = 'Reached the edit turn limit for this message — the changes made so far are saved. Ask again to continue.'
            send({ type: 'token', content: finalText })
          }
        }

        send({ type: 'done' })
        if (finalText) {
          await db.chatMessage.create({ data: { sessionId: chatSession!.id, role: 'assistant', content: finalText } })
        }
        // Keep fileCount accurate after any write_file/delete_file calls this turn.
        const count = await db.projectFile.count({ where: { projectId } })
        await db.project.update({ where: { id: projectId }, data: { fileCount: count } })
      } catch (e: any) {
        send({ type: 'error', message: e.message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}

async function executeTool(projectId: string, name: string, args: Record<string, any>): Promise<string> {
  const path = String(args.path || '').trim()
  if (!path) return 'Error: path is required'

  if (name === 'read_file') {
    const f = await db.projectFile.findUnique({ where: { projectId_path: { projectId, path } } })
    if (!f) return `Error: ${path} does not exist. Available files were listed in the system prompt.`
    return f.content

  } else if (name === 'str_replace_in_file') {
    const oldStr = String(args.old_str ?? '')
    const newStr = String(args.new_str ?? '')
    const f = await db.projectFile.findUnique({ where: { projectId_path: { projectId, path } } })
    if (!f) return `Error: ${path} does not exist. Use write_file to create it.`
    const occurrences = f.content.split(oldStr).length - 1
    if (occurrences === 0) return `Error: old_str not found in ${path}. read_file again to see its current exact content.`
    if (occurrences > 1) return `Error: old_str appears ${occurrences} times in ${path} — it must be unique. Include more surrounding context.`
    const updated = f.content.replace(oldStr, newStr)
    await db.projectFile.update({ where: { id: f.id }, data: { content: updated, size: updated.length } })
    return `Updated ${path} (${updated.length} chars).`

  } else if (name === 'write_file') {
    const content = String(args.content ?? '')
    const language = String(args.language || 'text')
    await db.projectFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, content, language, size: content.length },
      update: { content, language, size: content.length },
    })
    return `Saved ${path} (${content.length} chars).`

  } else if (name === 'delete_file') {
    await db.projectFile.deleteMany({ where: { projectId, path } })
    return `Deleted ${path}.`
  }

  return `Unknown tool ${name}`
}
