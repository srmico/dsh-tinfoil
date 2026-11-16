import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { TinfoilPiiClient } from './client.js'
import type { ResolvedConfig } from './config.js'
import { TinfoilPiiError } from './errors.js'
import { assertTextInputSize, decodeUtf8Text } from './payload.js'
import type { RedactionResult } from './payload.js'

export interface PiiToolDependencies {
  config: ResolvedConfig
  client: TinfoilPiiClient
}

function spanHeader(spanCount: number): string {
  return spanCount === 0 ? 'No spans reported.' : `Redacted ${spanCount} span${spanCount === 1 ? '' : 's'}.`
}

function formatTextResult(value: RedactionResult): string {
  return `${spanHeader(value.spanCount)}\n\n${value.redactedText}`
}

function fileTooLarge(path: string, size: number | undefined, maxBytes: number, cause?: unknown): TinfoilPiiError {
  const actual = size === undefined ? 'The file' : `"${path}" is ${size} bytes`
  return new TinfoilPiiError(
    `${actual}, which exceeds maxFileInputBytes (${maxBytes}). Split the file into smaller segments at line or paragraph boundaries. Redaction is not applied across chunks, so an entity split between chunks can be missed.`,
    'INPUT_TOO_LARGE',
    cause === undefined ? undefined : { cause },
  )
}

export function registerRedactText(ctx: Context, deps: PiiToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'redact_text',
    description: 'Redact likely personal data from a string and return the complete redacted text. The filter is best-effort and primarily English: it can miss sensitive values and can flag public text. For a file on disk, use redact_file so the redacted content stays out of context.',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: `Text to redact. Up to maxTextInputBytes (${deps.config.maxTextInputBytes}) UTF-8 bytes; larger text is rejected rather than split.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          redactedText: { type: 'string', required: true },
          spanCount: { type: 'integer', required: true },
        },
      },
      render: (_args, value): ContentBlock[] => [{ type: 'text', text: formatTextResult(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      assertTextInputSize(args.text, deps.config.maxTextInputBytes)
      return deps.client.redact({ text: args.text, signal: exec.signal })
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Redact text (${args.text.length} characters)`,
        kind: 'other',
      }
    },
  }))
}

export function registerRedactFile(ctx: Context, deps: PiiToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'redact_file',
    description: 'Redact a UTF-8 text file and write the redacted content to another file. Returns the output path, byte counts, and span count, not the redacted text, so file contents stay out of context. Use redact_text for a string.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the UTF-8 text file to redact.',
      },
      output_path: {
        type: 'string',
        required: true,
        description: 'Destination for the redacted file. Must differ from file_path; an existing output is written subject to the filesystem write policy.',
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
          spanCount: { type: 'integer', required: true },
        },
      },
      render: (_args, value): ContentBlock[] => [{
        type: 'text',
        text: `${spanHeader(value.spanCount)}\nWrote ${value.outputPath} (${value.outputBytes} bytes; input ${value.inputBytes} bytes).`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      deps.client.assertApiKey()
      const cwd = exec.agent === undefined
        ? undefined
        : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const resolveOptions = {
        ...(cwd === undefined ? {} : { cwd }),
        signal: exec.signal,
      }
      const inputTarget = await ctx.fs.resolve(args.file_path, resolveOptions)
      const outputTarget = await ctx.fs.resolve(args.output_path, resolveOptions)
      if (inputTarget.targetKey === outputTarget.targetKey) {
        throw new TinfoilPiiError(
          'output_path must differ from file_path; the source file is not overwritten.',
          'OUTPUT_IS_INPUT',
        )
      }
      const info = await ctx.fs.stat(inputTarget, exec.signal)
      if (info === undefined) {
        ctx.emit('fs/observed', inputTarget, { kind: 'absent' }, exec)
        throw new FsError(`cannot read "${inputTarget.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') {
        throw new FsError(`cannot read "${inputTarget.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (info.size !== undefined && info.size > deps.config.maxFileInputBytes) {
        throw fileTooLarge(inputTarget.displayPath, info.size, deps.config.maxFileInputBytes)
      }
      let data: Uint8Array
      try {
        data = await ctx.fs.readBytes(inputTarget, exec.signal, deps.config.maxFileInputBytes)
      } catch (error) {
        if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
          throw fileTooLarge(inputTarget.displayPath, undefined, deps.config.maxFileInputBytes, error)
        }
        throw error
      }
      ctx.emit('fs/observed', inputTarget, { kind: 'present', version: info.version }, exec)
      const text = decodeUtf8Text(data)
      const result = await deps.client.redact({ text, signal: exec.signal })
      const intent = await ctx.waterfall('fs/write-intent', outputTarget, exec, () => undefined)
      const outcome = await ctx.fs.writeText(outputTarget, result.redactedText, intent, exec.signal)
      ctx.emit('fs/observed', outputTarget, { kind: 'present', version: outcome.version }, exec)
      return {
        inputPath: ctx.fs.processPath(inputTarget),
        outputPath: ctx.fs.processPath(outputTarget),
        inputBytes: data.byteLength,
        outputBytes: Buffer.byteLength(result.redactedText, 'utf8'),
        spanCount: result.spanCount,
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Redact ${args.file_path} to ${args.output_path}`,
        kind: 'other',
        locations: [{ path: args.file_path }, { path: args.output_path }],
      }
    },
  }))
}
