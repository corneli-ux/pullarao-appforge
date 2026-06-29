import ZAI from 'z-ai-web-dev-sdk'
import { z } from 'zod'

/**
 * Pullarao 1 service — single entry point for all AI features.
 *
 * Pullarao 1 is the open-source flagship model (powered by the GLM 5.2
 * architecture). We talk to it via the ZAI SDK, which is OpenAI-compatible
 * and routes to the model endpoint.
 *
 * Capabilities used:
 *  - streaming chat completions (for real-time UX)
 *  - tool / function calling (for orchestration: create_repo, deploy, etc.)
 *  - structured output via JSON schema (for project file generation)
 */

const MODEL_ID = 'glm-5.2' // upstream identifier — do not rename
const MODEL_DISPLAY_NAME = 'Pullarao 1'

let _zai: ZAI | null = null
async function getClient(): Promise<ZAI> {
  if (_zai) return _zai
  _zai = await ZAI.create()
  return _zai
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
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

/**
 * Non-streaming chat — used for one-shot tasks like file generation.
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
  const client = await getClient()
  const response = await client.chat.completions.create({
    model: MODEL_ID,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.tools ? ({ tools: opts.tools as any } as any) : {}),
    ...(opts.json ? ({ response_format: { type: 'json_object' } } as any) : {}),
    thinking: { type: 'disabled' },
  })
  const choice = response.choices?.[0]
  const content = (choice?.message as any)?.content ?? ''
  // ZAI returns tool_calls on the message if any
  const rawToolCalls = (choice?.message as any)?.tool_calls ?? []
  const toolCalls = rawToolCalls.map((tc: any) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
  })).filter((tc: any) => tc.name)
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
  // When stream:true the ZAI SDK returns the raw ReadableStream from the
  // fetch Response (not a Response object). We read it directly.
  const client = await getClient()
  const stream: ReadableStream<Uint8Array> = await client.chat.completions.create({
    model: MODEL_ID,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    ...(opts.tools ? ({ tools: opts.tools as any } as any) : {}),
    thinking: { type: 'disabled' },
  } as any)

  let full = ''
  const reader = stream.getReader()
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
 * Generate structured output — used for project file generation.
 * Pullarao 1 returns JSON conforming to the provided Zod schema.
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
