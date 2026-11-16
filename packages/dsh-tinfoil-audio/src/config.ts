import {
  DEFAULT_API_KEY_ENV,
  nonEmptyString,
  positiveInteger,
  resolveApiKeyEnv,
} from '@srmico/dsh-tinfoil-lib'
import z from '@deepseek-ai/schemastery'

export type TranscriptFormat = 'text' | 'json' | 'verbose_json'
export type SpeechFormat = 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm'

export interface Config {
  apiKeyEnv?: string
  transcriptionModel?: string
  speechModel?: string
  defaultVoice?: string
  defaultLanguage?: string
  defaultTranscriptFormat?: TranscriptFormat
  speechFormat?: SpeechFormat
  maxInputBytes?: number
  maxSpeechChars?: number
  maxResponseBytes?: number
  requestTimeoutMs?: number
  includeProviderErrorDetail?: boolean
}

export interface ResolvedConfig {
  apiKeyEnv: string
  transcriptionModel: string
  speechModel: string
  defaultVoice: string
  defaultLanguage?: string
  defaultTranscriptFormat: TranscriptFormat
  speechFormat: SpeechFormat
  maxInputBytes: number
  maxSpeechChars: number
  maxResponseBytes: number
  requestTimeoutMs: number
  includeProviderErrorDetail: boolean
}

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).description('Environment variable holding the Tinfoil API key.'),
  transcriptionModel: z.string().default('whisper-large-v3-turbo').description('Default Tinfoil speech-to-text model id.'),
  speechModel: z.string().default('qwen3-tts').description('Default Tinfoil text-to-speech model id.'),
  defaultVoice: z.string().default('serena').description('Default Tinfoil text-to-speech voice.'),
  defaultLanguage: z.string().description('ISO-639-1 language hint used when a transcription call omits language.'),
  defaultTranscriptFormat: z.union(['text', 'json', 'verbose_json'] as const).default('text').description('Default output format for transcribe_audio_to_file.'),
  speechFormat: z.union(['wav', 'mp3', 'flac', 'opus', 'pcm'] as const).default('wav').description('Audio format requested from the Tinfoil speech endpoint.'),
  maxInputBytes: z.number().default(26214400).description('Maximum audio file size in bytes for transcription.'),
  maxSpeechChars: z.number().default(4096).description('Maximum characters accepted by synthesize_speech. The hosted talker context is 4096 tokens, shared with generated audio.'),
  maxResponseBytes: z.number().default(33554432).description('Maximum provider response body in bytes.'),
  requestTimeoutMs: z.number().default(600000).description('Tinfoil audio deadline in milliseconds, including attestation.'),
  includeProviderErrorDetail: z.boolean().default(false).description('Include bounded provider error detail in model-visible errors. Treat it as untrusted.'),
})

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const defaultLanguage = config.defaultLanguage === undefined
    ? undefined
    : nonEmptyString(config.defaultLanguage, 'tinfoil-audio: defaultLanguage')
  return {
    apiKeyEnv: resolveApiKeyEnv(config.apiKeyEnv, 'tinfoil-audio: apiKeyEnv'),
    transcriptionModel: nonEmptyString(config.transcriptionModel ?? 'whisper-large-v3-turbo', 'tinfoil-audio: transcriptionModel'),
    speechModel: nonEmptyString(config.speechModel ?? 'qwen3-tts', 'tinfoil-audio: speechModel'),
    defaultVoice: nonEmptyString(config.defaultVoice ?? 'serena', 'tinfoil-audio: defaultVoice'),
    ...(defaultLanguage === undefined ? {} : { defaultLanguage }),
    defaultTranscriptFormat: config.defaultTranscriptFormat ?? 'text',
    speechFormat: config.speechFormat ?? 'wav',
    maxInputBytes: positiveInteger(config.maxInputBytes ?? 26214400, 'tinfoil-audio: maxInputBytes'),
    maxSpeechChars: positiveInteger(config.maxSpeechChars ?? 4096, 'tinfoil-audio: maxSpeechChars'),
    maxResponseBytes: positiveInteger(config.maxResponseBytes ?? 33554432, 'tinfoil-audio: maxResponseBytes'),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs ?? 600000, 'tinfoil-audio: requestTimeoutMs'),
    includeProviderErrorDetail: config.includeProviderErrorDetail ?? false,
  }
}
