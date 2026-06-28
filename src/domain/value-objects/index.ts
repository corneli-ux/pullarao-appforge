/**
 * Value Objects — primitive types that carry domain meaning.
 * Centralized here so the whole app uses one source of truth.
 */

export type ChatModel = 'glm-4.6' | 'glm-4.5' | 'glm-4-plus' | 'glm-4-air' | 'glm-4-flash'

export type ImageSize =
  | '1024x1024'
  | '768x1344'
  | '864x1152'
  | '1344x768'
  | '1152x864'
  | '1440x720'
  | '720x1440'

export type VideoSize = '1920x1080' | '1080x1920' | '1280x720' | '720x1280'

export type VideoQuality = 'speed' | 'quality'

export type Voice = 'tongtong' | 'male' | 'female'

export type AudioFormat = 'wav' | 'pcm' | 'mp3'

export type ThinkingMode = 'enabled' | 'disabled'

export interface ChatParams {
  model: ChatModel
  temperature: number
  maxTokens: number
  topP: number
  thinking: ThinkingMode
  systemPrompt?: string
}

export const DEFAULT_CHAT_PARAMS: ChatParams = {
  model: 'glm-4.6',
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.9,
  thinking: 'disabled',
  systemPrompt: '',
}

export const IMAGE_SIZES: { label: string; value: ImageSize; ratio: string }[] = [
  { label: 'Square 1:1', value: '1024x1024', ratio: '1 / 1' },
  { label: 'Portrait 3:5', value: '768x1344', ratio: '3 / 5' },
  { label: 'Portrait 3:4', value: '864x1152', ratio: '3 / 4' },
  { label: 'Landscape 5:3', value: '1344x768', ratio: '5 / 3' },
  { label: 'Landscape 4:3', value: '1152x864', ratio: '4 / 3' },
  { label: 'Wide 2:1', value: '1440x720', ratio: '2 / 1' },
  { label: 'Tall 1:2', value: '720x1440', ratio: '1 / 2' },
]

export const VOICES: { label: string; value: Voice }[] = [
  { label: 'Tongtong (default)', value: 'tongtong' },
  { label: 'Male voice', value: 'male' },
  { label: 'Female voice', value: 'female' },
]

export const CHAT_MODELS: { label: string; value: ChatModel; description: string }[] = [
  { label: 'GLM-4.6', value: 'glm-4.6', description: 'Latest flagship — best reasoning, multimodal-aware' },
  { label: 'GLM-4.5', value: 'glm-4.5', description: 'Balanced quality and speed' },
  { label: 'GLM-4-Plus', value: 'glm-4-plus', description: 'Long-context, stable for production' },
  { label: 'GLM-4-Air', value: 'glm-4-air', description: 'Cost-efficient, great for high-throughput' },
  { label: 'GLM-4-Flash', value: 'glm-4-flash', description: 'Fastest inference, ideal for chat & quick replies' },
]
