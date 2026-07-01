import { z } from 'zod'

/**
 * Pullarao 1 service — single entry point for all AI features.
 *
 * Pullarao 1 is the open-source flagship model (powered by the GLM 5.2
 * architecture). We call GLM directly via fetch — NOT the z-ai-web-dev-sdk,
 * which reads from a .z-ai-config file that doesn't exist (and can't be
 * written) on Vercel's read-only serverless filesystem. This mirrors the
 * fix already applied to /api/glm/chat/route.ts and friends.
 *
 * Capabilities used:
 *  - streaming chat completions (for real-time UX)
 *  - tool / function calling (for project generation — see templates/index.ts
 *    for the agentic write_file loop this powers)
 *  - structured output via JSON schema (for smaller one-shot generations)
 */

const MODEL_ID = process.env.GLM_MODEL || 'glm-5.2'
const MODEL_DISPLAY_NAME = 'Pullarao 1'

function apiKey(): string {
  const key = process.env.GLM_API_KEY
  if (!key) throw new Error('Platform not configured — admin must set GLM_API_KEY')
  return key
}

function baseUrl(): string {
  return (process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/').replace(/\/$/, '')
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface RawToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  /** Present on assistant messages that made tool calls — must be echoed
   *  back verbatim on the next turn so GLM can match tool results to calls. */
  tool_calls?: RawToolCall[]
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown> // JSON schema
  }
}

export interface StreamCallbacks {
  onToken?: (token: string) => void
  onToolCall?: (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => void
  onDone?: (full: string) => void
}

function toWireMessage(m: ChatMessage) {
  return {
    role: m.role,
    content: m.content,
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
  }
}

/**
 * Non-streaming chat — used for tool-calling loops and one-shot tasks.
 */
export async function chat(
  messages: ChatMessage[],
  opts: {
    temperature?: number
    maxTokens?: number
    tools?: ToolDefinition[]
    json?: boolean // force JSON output
  } = {}
): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }> {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: MODEL_ID,
      messages: messages.map(toWireMessage),
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      thinking: { type: 'disabled' },
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`GLM API error ${res.status}: ${errText.slice(0, 500)}`)
  }
  const data = await res.json()
  const choice = data.choices?.[0]
  const content = choice?.message?.content ?? ''
  const rawToolCalls = choice?.message?.tool_calls ?? []
  const toolCalls = rawToolCalls
    .map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
    }))
    .filter((tc: any) => tc.name)
  return { content, toolCalls }
}

/**
 * Streaming chat — used for the in-app assistant.
 * Calls onToken for each text delta, onToolCall when GLM invokes a tool.
 */
export async function streamChat(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  opts: { temperature?: number; maxTokens?: number; tools?: ToolDefinition[] } = {}
): Promise<void> {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: MODEL_ID,
      messages: messages.map(toWireMessage),
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      thinking: { type: 'disabled' },
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`GLM API error ${res.status}: ${errText.slice(0, 500)}`)
  }

  let full = ''
  const reader = res.body!.getReader()
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
          callbacks.onToken?.(delta.content)
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
              callbacks.onToolCall?.({ id: tc.id, name: tc.function.name, arguments: args })
            }
          }
        }
      } catch {
        // partial JSON — wait for more
      }
    }
  }
  callbacks.onDone?.(full)
}

/**
 * Generate structured output — used for small, single-shot JSON tasks.
 * For anything file-sized (a whole project), use the agentic write_file
 * loop in templates/index.ts instead — a single JSON blob has a hard
 * max_tokens ceiling that silently truncates larger projects.
 */
export async function generateJson<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<T> {
  const systemPrompt = `You are a code generation assistant. Respond ONLY with valid JSON that conforms to this schema:\n\n${JSON.stringify(schemaDescription(schema))}\n\nNo markdown, no explanation, just JSON.`
  const { content } = await chat(
    [{ role: 'system', content: systemPrompt }, ...messages],
    { ...opts, json: true, temperature: opts.temperature ?? 0.4 }
  )
  const cleaned = content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(cleaned)
  return schema.parse(parsed)
}

function schemaDescription(schema: z.ZodType<any>): any {
  // Best-effort JSON-schema-like description from a Zod schema
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any).shape
    const props: Record<string, any> = {}
    for (const [k, v] of Object.entries(shape)) {
      props[k] = schemaDescription(v as z.ZodType<any>)
    }
    return { type: 'object', properties: props, required: Object.keys(shape) }
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: schemaDescription((schema as any).element) }
  }
  if (schema instanceof z.ZodString) return { type: 'string' }
  if (schema instanceof z.ZodNumber) return { type: 'number' }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: (schema as any).options }
  return { type: 'string' }
}

/**
 * Orchestration tools — passed to Pullarao 1 so it can call into our platform.
 * The user's chat can say "create a repo and push the code" and GLM will
 * invoke these tools; our API layer executes them and returns results.
 */
export const ORCHESTRATION_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'generate_project_files',
      description: 'Generate all source files for the requested app based on the user description. Returns a manifest of files.',
      parameters: {
        type: 'object',
        properties: {
          appType: { type: 'string', enum: ['ANDROID_APP', 'WEB_APP', 'STATIC_SITE'] },
          framework: { type: 'string', description: 'nextjs | static-html | android-native' },
          description: { type: 'string' },
        },
        required: ['appType', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_github_repo',
      description: 'Create a new GitHub repository in the user account and push the generated files.',
      parameters: {
        type: 'object',
        properties: {
          repoName: { type: 'string' },
          private: { type: 'boolean' },
          description: { type: 'string' },
        },
        required: ['repoName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deploy_webapp',
      description: 'Deploy a web app to the user’s configured deployment target (Vercel / Netlify / Cloudflare).',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['VERCEL', 'NETLIFY', 'CLOUDFLARE_PAGES'] },
          projectId: { type: 'string' },
        },
        required: ['provider', 'projectId'],
      },
    },
  },
]

export const GLM_MODEL_ID = MODEL_ID
export const MODEL_NAME = MODEL_DISPLAY_NAME
