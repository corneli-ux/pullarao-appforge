import { chat, type ChatMessage, type ToolDefinition, type RawToolCall } from '../glm'

/**
 * Project generators — drive Pullarao 1 to produce complete project filesets.
 *
 * ARCHITECTURE (for students):
 * Earlier this asked GLM for the entire project as one giant JSON blob in a
 * single response. That breaks down for anything non-trivial: max_tokens
 * caps the response size, so a real Android project (20+ files: gradle
 * config, manifest, Kotlin sources, resources...) gets silently truncated
 * into invalid JSON.
 *
 * This is the same problem Claude Code and GLM-5.2's "agentic engineering"
 * mode are built to solve — instead of one huge response, the model calls a
 * `write_file` tool once per file, in a loop, until it calls `finish_project`.
 * Each turn only needs to produce one file's worth of tokens, so project
 * size is no longer bounded by a single response's token limit. This is a
 * real (if simplified) example of the "plan → act → repeat" loop that
 * powers agentic coding tools — read `generateProjectAgentic` below meta to
 * see the whole loop end to end.
 *
 * The one thing this does NOT do that Claude Code / a real CI pipeline does:
 * actually compile/run the generated code and feed errors back in. There's
 * no sandboxed build environment on the server (Vercel serverless can't run
 * `./gradlew build` or `npm run build` inside a request). That verification
 * instead happens for real, after the fact, in GitHub Actions once the
 * project is pushed — see `.github/workflows/*.yml` in generated repos.
 */

export interface GeneratedFile {
  path: string
  content: string
  language: string
}

export interface GeneratedProject {
  files: GeneratedFile[]
  summary: string
  framework: string
  appType: 'ANDROID_APP' | 'WEB_APP' | 'STATIC_SITE'
}

const MAX_TURNS = 60
const MAX_FILES = 80

const WRITE_FILE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description:
      'Write ONE file of the project. Call this once per file, in a sensible build order ' +
      '(project/build config first, then manifests, then source files, then resources). ' +
      'Do not try to fit multiple files into one call.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative path, e.g. "src/app/page.tsx"' },
        content: { type: 'string', description: 'The complete, final contents of this file' },
        language: {
          type: 'string',
          description: 'kotlin | typescript | javascript | json | yaml | toml | gradle | xml | html | css | md',
        },
      },
      required: ['path', 'content', 'language'],
    },
  },
}

const FINISH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'finish_project',
    description:
      'Call this exactly once, after every required file has been written with write_file, ' +
      'to signal the project is complete and buildable.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One paragraph describing what was built' },
      },
      required: ['summary'],
    },
  },
}

/**
 * The agentic generation loop.
 *
 *   1. Send the role prompt + user request, offering write_file / finish_project as tools
 *   2. GLM calls write_file — we save the file, echo a tool result, loop
 *   3. GLM calls finish_project — we stop
 *   4. If GLM replies with plain text instead of a tool call, we nudge it to
 *      keep calling tools (some models narrate progress in text sometimes)
 *
 * `onFile` is called synchronously after each file is produced, so callers
 * (see /api/projects/route.ts) can persist files incrementally — students
 * watching a project generate see files appear one by one, not all at once
 * at the very end.
 */
async function generateProjectAgentic(
  roleSystemPrompt: string,
  userDescription: string,
  appType: GeneratedProject['appType'],
  defaultFramework: string,
  onFile?: (f: GeneratedFile, index: number) => Promise<void> | void
): Promise<GeneratedProject> {
  const messages: ChatMessage[] = [
    { role: 'system', content: roleSystemPrompt },
    {
      role: 'user',
      content:
        `User request:\n\n${userDescription}\n\n` +
        `Build this now. Call write_file once per file — start with project/build config, ` +
        `then source files, then resources. Call finish_project only once everything needed ` +
        `to build and run the project has been written.`,
    },
  ]

  const files: GeneratedFile[] = []
  let summary = ''
  let finished = false

  for (let turn = 0; turn < MAX_TURNS && !finished && files.length < MAX_FILES; turn++) {
    const { content, toolCalls } = await chat(messages, {
      temperature: 0.3,
      maxTokens: 6000,
      tools: [WRITE_FILE_TOOL, FINISH_TOOL],
    })

    if (toolCalls.length === 0) {
      // Model responded with plain text instead of a tool call — nudge it back on track.
      messages.push({ role: 'assistant', content: content || '' })
      messages.push({
        role: 'user',
        content: files.length === 0
          ? 'Start writing files now — call write_file for the first file.'
          : 'Continue — call write_file for the next remaining file, or finish_project if the project is complete.',
      })
      continue
    }

    const rawToolCalls: RawToolCall[] = toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }))
    messages.push({ role: 'assistant', content: content || '', tool_calls: rawToolCalls })

    for (const tc of toolCalls) {
      if (tc.name === 'write_file') {
        const path = String(tc.arguments.path || '').trim()
        const fileContent = String(tc.arguments.content ?? '')
        const language = String(tc.arguments.language || 'text')
        if (!path) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: path is required. Retry with a valid path.' })
          continue
        }
        const file: GeneratedFile = { path, content: fileContent, language }
        files.push(file)
        await onFile?.(file, files.length - 1)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `Saved ${path} (${fileContent.length} chars). Continue with the next file.` })
      } else if (tc.name === 'finish_project') {
        summary = String(tc.arguments.summary || '')
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Project marked complete.' })
        finished = true
      } else {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `Unknown tool ${tc.name}` })
      }
    }
  }

  if (files.length === 0) {
    throw new Error('Pullarao 1 did not generate any files. Try a more specific description.')
  }
  if (!finished) {
    // Hit MAX_TURNS/MAX_FILES without an explicit finish — still return what we have
    // rather than throwing away real work, but note it in the summary.
    summary = summary || `Generated ${files.length} files (stopped at the turn/file limit before Pullarao 1 signaled completion — review for missing pieces).`
  }

  return { files, summary: summary || `Generated ${files.length} files.`, framework: defaultFramework, appType }
}

// ============================================================
//  ANDROID APP GENERATOR
// ============================================================

export async function generateAndroidApp(
  userDescription: string,
  packageName: string = 'com.user.app',
  onFile?: (f: GeneratedFile, index: number) => Promise<void> | void
): Promise<GeneratedProject> {
  const systemPrompt = `You are a senior Android engineer generating a COMPLETE, BUILDABLE Android Studio project (Kotlin + Jetpack Compose + Hilt + Room + Retrofit + Material 3), one file at a time via the write_file tool.

The project MUST include at minimum these files (call write_file once for each):
- settings.gradle.kts
- build.gradle.kts (root)
- gradle/libs.versions.toml (version catalog)
- gradle/wrapper/gradle-wrapper.properties
- gradlew (shell script starting with "#!/bin/sh")
- gradlew.bat (Windows wrapper)
- app/build.gradle.kts
- app/proguard-rules.pro
- app/src/main/AndroidManifest.xml
- app/src/main/java/${packageName.replace(/\./g, '/')}/MainActivity.kt
- app/src/main/java/${packageName.replace(/\./g, '/')}/${toPascalCase(appNameFromDescription(userDescription))}Application.kt
- app/src/main/res/values/strings.xml
- app/src/main/res/values/colors.xml
- app/src/main/res/values/themes.xml
- app/src/main/res/values-night/themes.xml
- app/src/main/res/xml/backup_rules.xml
- app/src/main/res/xml/data_extraction_rules.xml
- app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml (adaptive icon)
- app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml
- app/src/main/res/drawable/ic_launcher_background.xml (vector)
- app/src/main/res/drawable/ic_launcher_foreground.xml (vector)
- .github/workflows/android.yml (CI to build debug APK on push)
- .gitignore
- README.md
— plus every Kotlin source file the feature actually needs (screens, ViewModels, Room entities/DAOs, Retrofit interfaces, DI modules, navigation).

Rules:
- Application ID must be ${packageName}
- minSdk 26, targetSdk 35, compileSdk 35
- Use Kotlin 2.1, Compose BOM 2024.12.01, Hilt 2.53
- All code must compile cleanly. No unused imports, no unresolved references.
- Drawables must use literal color hex values, not ?attr/ references.
- The launcher foreground drawable must be defined as a vector drawable, not a mipmap resource.
- The .github/workflows/android.yml must run on push to main, set up JDK 17 + Gradle 8.10.2, generate the gradle wrapper, run assembleDebug, and upload the APK artifact.
- README.md should describe how to build locally and via GitHub Actions.
- Call write_file once per file — never combine multiple files into one call.
- Call finish_project only once the project is fully buildable end to end.`

  return generateProjectAgentic(systemPrompt, userDescription, 'ANDROID_APP', 'android-native', onFile)
}

// ============================================================
//  NEXT.JS WEB APP GENERATOR
// ============================================================

export async function generateNextJsApp(
  userDescription: string,
  onFile?: (f: GeneratedFile, index: number) => Promise<void> | void
): Promise<GeneratedProject> {
  const systemPrompt = `You are a senior fullstack engineer generating a COMPLETE Next.js 16 project (App Router + TypeScript + Tailwind CSS 4 + shadcn/ui), one file at a time via the write_file tool.

The project MUST include (call write_file once for each):
- package.json (Next 16, React 19, TypeScript 5, Tailwind 4)
- next.config.ts
- tsconfig.json
- tailwind.config.ts
- postcss.config.mjs
- src/app/layout.tsx
- src/app/page.tsx (the main UI fulfilling the user's request)
- src/app/globals.css
- src/components/ui/button.tsx (shadcn-style)
- src/components/ui/card.tsx
- src/components/ui/input.tsx
- src/lib/utils.ts (cn helper)
- .gitignore
- .env.example
- README.md
— plus every additional component, route, and lib file the feature actually needs.

Rules:
- All code must compile cleanly with no type errors.
- Use server components by default, mark client components with 'use client'.
- Tailwind 4 syntax (no @tailwind directives, use @import "tailwindcss").
- The page must be visually polished, mobile-first, accessible.
- Call write_file once per file — never combine multiple files into one call.
- Call finish_project only once the project is fully buildable end to end.`

  return generateProjectAgentic(systemPrompt, userDescription, 'WEB_APP', 'nextjs', onFile)
}

// ============================================================
//  STATIC SITE GENERATOR
// ============================================================

export async function generateStaticSite(
  userDescription: string,
  onFile?: (f: GeneratedFile, index: number) => Promise<void> | void
): Promise<GeneratedProject> {
  const systemPrompt = `You are a frontend designer generating a COMPLETE static website (HTML + CSS + vanilla JS), one file at a time via the write_file tool. Single page or multi-page as appropriate.

Must include:
- index.html (entry point)
- styles.css (or a styles/ directory)
- script.js (or a scripts/ directory)
- README.md
— plus any additional pages/assets the request needs.

Rules:
- Valid HTML5, semantic tags, mobile-first.
- No build step required — opens directly in browser.
- Inline critical CSS only if it improves perceived performance.
- Call write_file once per file — never combine multiple files into one call.
- Call finish_project only once the site is fully complete.`

  return generateProjectAgentic(systemPrompt, userDescription, 'STATIC_SITE', 'static-html', onFile)
}

// ============================================================
//  HELPERS
// ============================================================

function toPascalCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('') || 'App'
}

function appNameFromDescription(d: string): string {
  // Take first two words of description as app name
  return d.split(/\s+/).slice(0, 2).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'app'
}

export function suggestRepoName(description: string): string {
  return appNameFromDescription(description)
    .slice(0, 40)
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
