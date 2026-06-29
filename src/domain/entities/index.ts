/**
 * Domain Entities — pure business objects with no framework dependencies.
 * These mirror what gets persisted in the database and exchanged with AI services.
 */

export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: Date
  /** Optional thinking trace when thinking mode is enabled */
  thinking?: string
  /** Attachments referenced by this message (image / file / video URLs) */
  attachments?: Attachment[]
  /** Token usage for billing/UX feedback */
  tokens?: number
}

export interface Attachment {
  id: string
  type: 'image' | 'file' | 'video'
  url: string
  name?: string
  mimeType?: string
}

export interface Conversation {
  id: string
  title: string
  systemPrompt?: string
  model: string
  thinkingEnabled: boolean
  messages: Message[]
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedImage {
  id: string
  prompt: string
  size: string
  base64: string
  createdAt: Date
}

export interface GeneratedVideo {
  id: string
  prompt: string
  taskId: string
  status: 'PROCESSING' | 'SUCCESS' | 'FAIL'
  videoUrl?: string
  quality: 'speed' | 'quality'
  size: string
  fps: number
  duration: number
  createdAt: Date
  completedAt?: Date
}

export interface VoiceClip {
  id: string
  text: string
  voice: string
  speed: number
  format: 'wav' | 'pcm' | 'mp3'
  audioBase64?: string
  audioUrl?: string
  createdAt: Date
}

export interface Transcription {
  id: string
  text: string
  fileName: string
  durationMs?: number
  createdAt: Date
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source?: string
  publishedDate?: string
}

export interface PageReadResult {
  title: string
  url: string
  html: string
  publishedTime?: string
  tokens?: number
}

export interface FineTuneJob {
  id: string
  name: string
  status: 'draft' | 'queued' | 'training' | 'completed' | 'failed'
  baseModel: string
  datasetName: string
  examples: number
  epochs: number
  learningRate: number
  createdAt: Date
  progress?: number
  loss?: number
}

export interface FineTuneDataset {
  id: string
  name: string
  description: string
  examples: number
  size: number
  format: 'jsonl' | 'csv'
  createdAt: Date
}
