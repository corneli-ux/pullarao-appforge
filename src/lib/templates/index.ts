import { z } from 'zod'
import { chat, GLM_MODEL_ID, type ChatMessage } from '../glm'

/**
 * Project generators — drive Pullarao 1 to produce complete project filesets.
 *
 * Each generator:
 *   1. Builds a domain-specific system prompt
 *   2. Sends the user's description
 *   3. Parses GLM's JSON response into a file manifest
 *   4. Returns the files ready to push to GitHub
 *
 * We use JSON-mode responses for structured output.
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

const fileManifestSchema = z.object({
  files: z.array(z.object({
    path: z.string().describe('Repo-relative path, e.g. "src/app/page.tsx"'),
    content: z.string().describe('Full file contents'),
    language: z.string().describe('Programming language: kotlin, typescript, javascript, json, yaml, toml, html, css, md'),
  })),
  summary: z.string().describe('One-paragraph summary of what was built'),
  framework: z.string(),
})

// ============================================================
//  ANDROID APP GENERATOR
// ============================================================

export async function generateAndroidApp(
  userDescription: string,
  packageName: string = 'com.user.app'
): Promise<GeneratedProject> {
  const systemPrompt = `You are a senior Android engineer. Generate a COMPLETE, BUILDABLE Android Studio project (Kotlin + Jetpack Compose + Hilt + Room + Retrofit + Material 3) that fulfills the user's request.

Output ONLY a JSON object matching this exact schema:
{
  "files": [{ "path": "...", "content": "...", "language": "kotlin"|"typescript"|"xml"|"json"|"toml"|"gradle"|"md"|"yaml" }],
  "summary": "One paragraph summary",
  "framework": "android-native"
}

The project MUST include these files at minimum:
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

Rules:
- Application ID must be ${packageName}
- minSdk 26, targetSdk 35, compileSdk 35
- Use Kotlin 2.1, Compose BOM 2024.12.01, Hilt 2.53
- All code must compile cleanly. No unused imports, no unresolved references.
- Drawables must use literal color hex values, not ?attr/ references.
- The launcher foreground drawable must be defined as a vector drawable, not a mipmap resource.
- The .github/workflows/android.yml must run on push to main, set up JDK 17 + Gradle 8.10.2, generate the gradle wrapper, run assembleDebug, and upload the APK artifact.
- README.md should describe how to build locally and via GitHub Actions.

Respond with JSON only — no markdown fences, no explanation.`

  return await callGenerator(systemPrompt, userDescription, 'ANDROID_APP', 'android-native')
}

// ============================================================
//  NEXT.JS WEB APP GENERATOR
// ============================================================

export async function generateNextJsApp(userDescription: string): Promise<GeneratedProject> {
  const systemPrompt = `You are a senior fullstack engineer. Generate a COMPLETE Next.js 16 project (App Router + TypeScript + Tailwind CSS 4 + shadcn/ui) that fulfills the user's request.

Output ONLY a JSON object matching this exact schema:
{
  "files": [{ "path": "...", "content": "...", "language": "typescript"|"javascript"|"json"|"css"|"md"|"tsx"|"html" }],
  "summary": "...",
  "framework": "nextjs"
}

The project MUST include:
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

Rules:
- All code must compile cleanly with no type errors.
- Use server components by default, mark client components with 'use client'.
- Tailwind 4 syntax (no @tailwind directives, use @import "tailwindcss").
- The page must be visually polished, mobile-first, accessible.

Respond with JSON only — no markdown fences, no explanation.`

  return await callGenerator(systemPrompt, userDescription, 'WEB_APP', 'nextjs')
}

// ============================================================
//  STATIC SITE GENERATOR
// ============================================================

export async function generateStaticSite(userDescription: string): Promise<GeneratedProject> {
  const systemPrompt = `You are a frontend designer. Generate a COMPLETE static website (HTML + CSS + vanilla JS) fulfilling the user's request. Single page or multi-page.

Output ONLY a JSON object matching this exact schema:
{
  "files": [{ "path": "...", "content": "...", "language": "html"|"css"|"javascript"|"json" }],
  "summary": "...",
  "framework": "static-html"
}

Must include:
- index.html (entry point)
- styles.css (or styles/ directory)
- script.js (or scripts/ directory)
- README.md

Rules:
- Valid HTML5, semantic tags, mobile-first.
- No build step required — opens directly in browser.
- Inline critical CSS only if it improves perceived performance.

Respond with JSON only — no markdown fences, no explanation.`

  return await callGenerator(systemPrompt, userDescription, 'STATIC_SITE', 'static-html')
}

// ============================================================
//  SHARED CALLER
// ============================================================

async function callGenerator(
  systemPrompt: string,
  userDescription: string,
  appType: 'ANDROID_APP' | 'WEB_APP' | 'STATIC_SITE',
  framework: string
): Promise<GeneratedProject> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User request:\n\n${userDescription}\n\nGenerate the complete project now.` },
  ]
  const { content } = await chat(messages, {
    temperature: 0.3,
    maxTokens: 16000,
    json: true,
  })
  // Strip any accidental markdown fences
  const cleaned = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  const parsed = fileManifestSchema.parse(JSON.parse(cleaned))
  return {
    files: parsed.files,
    summary: parsed.summary,
    framework: parsed.framework || framework,
    appType,
  }
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
