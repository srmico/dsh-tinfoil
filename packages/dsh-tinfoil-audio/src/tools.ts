import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import { audioExtension, audioMediaType, sanitizeAudioFilename, speechFileName, SUPPORTED_AUDIO_EXTENSIONS } from './audio.js'
import type { AudioExtension } from './audio.js'
import type { TinfoilAudioClient } from './client.js'
import type { ResolvedConfig, TranscriptFormat } from './config.js'
import { TinfoilAudioError } from './errors.js'
import { assertSpeechInput } from './payload.js'

export interface AudioToolDependencies {
  config: ResolvedConfig
  client: TinfoilAudioClient
}

interface LoadedAudio {
  target: FsTarget
  data: Uint8Array
  extension: AudioExtension
  cwd?: string
}

const SUPPORTED_EXTENSION_LIST = SUPPORTED_AUDIO_EXTENSIONS.join(', ')
const UNSAFE_ERROR = /[\u0000-\u001f\u007f]+/gu

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  return error.message.replace(UNSAFE_ERROR, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function attachmentFailure(error: unknown): TinfoilAudioError {
  if (errorCode(error) === 'ATTACHMENT_FILES_UNSUPPORTED') {
    return new TinfoilAudioError(
      'The mounted attachment provider cannot store verbatim files, so the generated audio cannot be saved. Use a profile with the local attachment provider.',
      'TTS_OUTPUT_UNSUPPORTED',
      { cause: error },
    )
  }
  return new TinfoilAudioError(
    `Could not save the generated audio: ${errorText(error)}`,
    'TTS_OUTPUT_FAILED',
    { cause: error },
  )
}

async function saveAudio(ctx: Context, data: Uint8Array, name: string): Promise<FileAttachmentRef> {
  try {
    return await ctx.attachments.saveFile({ data, name })
  } catch (error) {
    throw attachmentFailure(error)
  }
}

function unsupportedAudio(filePath: string): TinfoilAudioError {
  return new TinfoilAudioError(
    `"${filePath}" is not a supported audio file. Supported extensions: ${SUPPORTED_EXTENSION_LIST}.`,
    'UNSUPPORTED_AUDIO',
  )
}

function audioTooLarge(path: string, size: number | undefined, maxBytes: number, cause?: unknown): TinfoilAudioError {
  const actual = size === undefined ? 'The audio file' : `"${path}" is ${size} bytes`
  return new TinfoilAudioError(
    `${actual}, which exceeds maxInputBytes (${maxBytes}). The Tinfoil whisper backend also caps uploads at 25 MB; use a shorter or more compressed file.`,
    'INPUT_TOO_LARGE',
    cause === undefined ? undefined : { cause },
  )
}

async function loadAudio(
  ctx: Context,
  exec: ToolExecution,
  deps: AudioToolDependencies,
  filePath: string,
): Promise<LoadedAudio> {
  const extension = audioExtension(filePath)
  if (extension === undefined) throw unsupportedAudio(filePath)
  deps.client.assertApiKey()
  const cwd = exec.agent === undefined
    ? undefined
    : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
  const target = await ctx.fs.resolve(filePath, {
    ...(cwd === undefined ? {} : { cwd }),
    signal: exec.signal,
  })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  if (info.size !== undefined && info.size > deps.config.maxInputBytes) {
    throw audioTooLarge(target.displayPath, info.size, deps.config.maxInputBytes)
  }
  let data: Uint8Array
  try {
    data = await ctx.fs.readBytes(target, exec.signal, deps.config.maxInputBytes)
  } catch (error) {
    if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
      throw audioTooLarge(target.displayPath, undefined, deps.config.maxInputBytes, error)
    }
    throw error
  }
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  if (data.byteLength === 0) {
    throw new TinfoilAudioError('The audio file is empty.', 'AUDIO_EMPTY')
  }
  return {
    target,
    data,
    extension,
    ...(cwd === undefined ? {} : { cwd }),
  }
}

function resolveModel(value: string | undefined, fallback: string, name: string): string {
  const model = (value ?? fallback).trim()
  if (model.length === 0) {
    throw new TinfoilAudioError(`${name} must not be empty.`, 'INPUT_INVALID')
  }
  return model
}

function resolveLanguage(value: string | undefined, fallback: string | undefined): string | undefined {
  const raw = value ?? fallback
  if (raw === undefined) return undefined
  const language = raw.trim()
  if (language.length === 0) {
    throw new TinfoilAudioError('language must not be empty.', 'INPUT_INVALID')
  }
  return language.toLowerCase() === 'auto' ? undefined : language
}

function resolvePrompt(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const prompt = value.trim()
  return prompt.length === 0 ? undefined : prompt
}

function resolveTemperature(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TinfoilAudioError('temperature must be between 0 and 1.', 'INPUT_INVALID')
  }
  return value
}

function resolveFormat(value: TranscriptFormat | undefined, fallback: TranscriptFormat): TranscriptFormat {
  if (value === undefined) return fallback
  if (value !== 'text' && value !== 'json' && value !== 'verbose_json') {
    throw new TinfoilAudioError('response_format must be text, json, or verbose_json.', 'INPUT_INVALID')
  }
  return value
}

function requireNonEmptyPath(value: string, name: string): string {
  const path = value.trim()
  if (path.length === 0) throw new TinfoilAudioError(`${name} must not be empty.`, 'INPUT_INVALID')
  return path
}

export function registerTranscribeAudio(ctx: Context, deps: AudioToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'transcribe_audio',
    description: 'Transcribe a recorded audio file to text. Returns the complete transcript. Use transcribe_audio_to_file when the transcript should stay out of context.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: `Path to the audio file. Supported extensions: ${SUPPORTED_EXTENSION_LIST}.`,
      },
      model: {
        type: 'string',
        description: 'Provider model id. Defaults to the configured transcription model.',
      },
      language: {
        type: 'string',
        description: 'ISO-639-1 language hint, for example en. Omit to auto-detect.',
      },
      prompt: {
        type: 'string',
        description: 'Optional text to guide transcription style or vocabulary.',
      },
      temperature: {
        type: 'number',
        description: 'Sampling temperature from 0 to 1.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value): ContentBlock[] => [{
        type: 'text',
        text: value.text.length === 0 ? '(no speech recognized)' : value.text,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const filePath = requireNonEmptyPath(args.file_path, 'file_path')
      const loaded = await loadAudio(ctx, exec, deps, filePath)
      const language = resolveLanguage(args.language, deps.config.defaultLanguage)
      const prompt = resolvePrompt(args.prompt)
      const temperature = resolveTemperature(args.temperature)
      const result = await deps.client.transcribe({
        data: loaded.data,
        filename: sanitizeAudioFilename(filePath, loaded.extension),
        mediaType: audioMediaType(loaded.extension),
        model: resolveModel(args.model, deps.config.transcriptionModel, 'model'),
        ...(language === undefined ? {} : { language }),
        ...(prompt === undefined ? {} : { prompt }),
        ...(temperature === undefined ? {} : { temperature }),
        responseFormat: 'json',
        signal: exec.signal,
      })
      return { text: result.text }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Transcribe ${args.file_path}`,
        kind: 'other',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}

export function registerTranscribeAudioToFile(ctx: Context, deps: AudioToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'transcribe_audio_to_file',
    description: 'Transcribe an audio file and write the transcript to another file. Returns paths, byte counts, model, and format, not the transcript. Use transcribe_audio when the text is needed in context.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: `Path to the audio file. Supported extensions: ${SUPPORTED_EXTENSION_LIST}.`,
      },
      output_path: {
        type: 'string',
        required: true,
        description: 'Destination for the transcript. Must differ from file_path; an existing output is written subject to the filesystem write policy.',
      },
      model: {
        type: 'string',
        description: 'Provider model id. Defaults to the configured transcription model.',
      },
      language: {
        type: 'string',
        description: 'ISO-639-1 language hint, for example en. Omit to auto-detect.',
      },
      prompt: {
        type: 'string',
        description: 'Optional text to guide transcription style or vocabulary.',
      },
      temperature: {
        type: 'number',
        description: 'Sampling temperature from 0 to 1.',
      },
      response_format: {
        type: 'string',
        enum: ['text', 'json', 'verbose_json'],
        description: 'Format written to output_path. Defaults to the configured transcript format.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          inputPath: { type: 'string', required: true },
          outputPath: { type: 'string', required: true },
          inputBytes: { type: 'integer', required: true },
          outputBytes: { type: 'integer', required: true },
          model: { type: 'string', required: true },
          format: { type: 'string', enum: ['text', 'json', 'verbose_json'], required: true },
        },
      },
      render: (_args, value): ContentBlock[] => [{
        type: 'text',
        text: `Wrote ${value.outputPath} (${value.outputBytes} bytes; input ${value.inputBytes} bytes) with ${value.model}.`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const filePath = requireNonEmptyPath(args.file_path, 'file_path')
      const outputPath = requireNonEmptyPath(args.output_path, 'output_path')
      const loaded = await loadAudio(ctx, exec, deps, filePath)
      const outputTarget = await ctx.fs.resolve(outputPath, {
        ...(loaded.cwd === undefined ? {} : { cwd: loaded.cwd }),
        signal: exec.signal,
      })
      if (loaded.target.targetKey === outputTarget.targetKey) {
        throw new TinfoilAudioError(
          'output_path must differ from file_path; the source file is not overwritten.',
          'OUTPUT_IS_INPUT',
        )
      }
      const format = resolveFormat(args.response_format as TranscriptFormat | undefined, deps.config.defaultTranscriptFormat)
      const model = resolveModel(args.model, deps.config.transcriptionModel, 'model')
      const language = resolveLanguage(args.language, deps.config.defaultLanguage)
      const prompt = resolvePrompt(args.prompt)
      const temperature = resolveTemperature(args.temperature)
      const result = await deps.client.transcribe({
        data: loaded.data,
        filename: sanitizeAudioFilename(filePath, loaded.extension),
        mediaType: audioMediaType(loaded.extension),
        model,
        ...(language === undefined ? {} : { language }),
        ...(prompt === undefined ? {} : { prompt }),
        ...(temperature === undefined ? {} : { temperature }),
        responseFormat: format,
        signal: exec.signal,
      })
      const intent = await ctx.waterfall('fs/write-intent', outputTarget, exec, () => undefined)
      const outcome = await ctx.fs.writeText(outputTarget, result.raw, intent, exec.signal)
      ctx.emit('fs/observed', outputTarget, { kind: 'present', version: outcome.version }, exec)
      return {
        inputPath: ctx.fs.processPath(loaded.target),
        outputPath: ctx.fs.processPath(outputTarget),
        inputBytes: loaded.data.byteLength,
        outputBytes: Buffer.byteLength(result.raw, 'utf8'),
        model,
        format,
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Transcribe ${args.file_path} to ${args.output_path}`,
        kind: 'other',
        locations: [{ path: args.file_path }, { path: args.output_path }],
      }
    },
  }))
}

export function registerSynthesizeSpeech(ctx: Context, deps: AudioToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'synthesize_speech',
    description: 'Generate speech audio from text and save it as a durable file. Returns the saved path and metadata; it does not play the audio. The hosted talker context is shared with the generated audio, so long input can be rejected.',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: `Text to synthesize. Up to maxSpeechChars (${deps.config.maxSpeechChars}) characters; the hosted talker's 4096-token context is shared with the generated audio.`,
      },
      model: {
        type: 'string',
        description: 'Provider model id. Defaults to the configured speech model.',
      },
      voice: {
        type: 'string',
        description: 'Provider voice name. Defaults to the configured voice.',
      },
      file_name: {
        type: 'string',
        description: 'Display name for the saved audio. The extension follows the returned format.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          mediaType: { type: 'string', required: true },
          model: { type: 'string', required: true },
          voice: { type: 'string', required: true },
          durationSeconds: { type: 'number' },
        },
      },
      render: (_args, value): ContentBlock[] => {
        const duration = value.durationSeconds === undefined ? '' : `, ${value.durationSeconds.toFixed(1)}s`
        return [{
          type: 'text',
          text: `Saved ${value.path} (${value.bytes} bytes${duration}) with ${value.model} (${value.voice}).`,
        }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      assertSpeechInput(args.text, deps.config.maxSpeechChars)
      const model = resolveModel(args.model, deps.config.speechModel, 'model')
      const voice = resolveModel(args.voice, deps.config.defaultVoice, 'voice')
      const result = await deps.client.synthesize({
        text: args.text,
        model,
        voice,
        responseFormat: deps.config.speechFormat,
        signal: exec.signal,
      })
      const ref = await saveAudio(ctx, result.data, speechFileName(args.file_name, result.extension))
      let path: string | undefined
      try {
        path = ctx.attachments.fileHostPath(ref)
      } catch (error) {
        throw new TinfoilAudioError(
          `Could not resolve the saved audio path: ${errorText(error)}`,
          'TTS_OUTPUT_FAILED',
          { cause: error },
        )
      }
      if (path === undefined) {
        throw new TinfoilAudioError(
          'The mounted attachment provider does not expose a readable audio path.',
          'TTS_OUTPUT_UNSUPPORTED',
        )
      }
      return {
        path,
        bytes: ref.bytes,
        mediaType: result.mediaType,
        model,
        voice,
        ...(result.durationSeconds === undefined ? {} : { durationSeconds: result.durationSeconds }),
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Synthesize speech (${args.text.length} characters)`,
        kind: 'other',
      }
    },
  }))
}
