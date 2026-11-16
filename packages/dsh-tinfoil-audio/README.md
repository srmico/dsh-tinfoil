# @srmico/dsh-tinfoil-audio

Audio transcription and text-to-speech for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
through Tinfoil's attested audio endpoints.

## Installation

```sh
# All Tinfoil capabilities:
dsh plugin add @srmico/dsh-tinfoil

# Audio alone:
dsh plugin add @srmico/dsh-tinfoil-audio
```

The package is a plugin and a bundle, so a standalone install activates its row. Do not install the
root bundle and this package together; the duplicate row id becomes unaddressable in the Plugins UI.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `transcribe_audio` | `file_path`, optional `model`, `language`, `prompt`, `temperature` | The complete transcript. |
| `transcribe_audio_to_file` | `file_path`, `output_path`, same options, optional `response_format` | Paths, byte counts, model, and format; no transcript. |
| `synthesize_speech` | `text`, optional `model`, `voice`, `file_name` | Saved audio path, bytes, media type, model, voice, and optional duration. |

Supported transcription extensions: `.flac`, `.mp3`, `.mp4`, `.mpeg`, `.mpga`, `.m4a`, `.ogg`,
`.wav`, `.webm`. The current Web UI does not play the generated audio; open the returned path.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0`, Node `^24.22.1 || >=26.12.1`.
- A profile with `tools`; transcription also needs `fs` and `workingDirectory`; speech needs
  `attachments`.
- `TINFOIL_API_KEY` in the launch environment or `$DSH_HOME/.env`.

## Configuration

```yaml
- id: tinfoil-audio
  config:
    speechModel: qwen3-tts
    defaultVoice: serena
```

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `TINFOIL_API_KEY` | Environment variable holding the key. |
| `transcriptionModel` | `whisper-large-v3-turbo` | Default speech-to-text model. |
| `speechModel` | `qwen3-tts` | Default text-to-speech model. |
| `defaultVoice` | `serena` | Default voice. Voices are model-specific. |
| `defaultLanguage` | unset | Language hint when a call omits one. |
| `defaultTranscriptFormat` | `text` | Format written by `transcribe_audio_to_file`. |
| `speechFormat` | `wav` | Requested speech format. |
| `maxInputBytes` | `26214400` (25 MiB) | Transcription input cap. |
| `maxSpeechChars` | `4096` | Speech input cap; the hosted talker context is shared with generated audio. |
| `maxResponseBytes` | `33554432` (32 MiB) | Response cap. |
| `requestTimeoutMs` | `600000` | Deadline, including attestation. |
| `includeProviderErrorDetail` | `false` | Include bounded provider detail in model-visible errors. Treat it as untrusted. |

## Security and attestation

All calls use Tinfoil's `SecureClient` and the attested router. There is no endpoint, self-hosted, or
unattested mode. Audio bytes, transcripts, and requested speech text are never logged; no requests or
responses are cached. Generated speech is a durable attachment under the host's attachment root and
should be treated as sensitive.

## Limitations

- Hosted-only; no realtime streaming, translations, or speech-provider registration.
- Voices are model-specific; validate a configured voice against the selected speech model.
- TTS input is capped because the talker context is shared with generated audio.
- No automated tests yet.

## Development

Build and typecheck from the repository root; see
[Development](https://github.com/srmico/dsh-tinfoil/blob/main/docs/DEVELOPMENT.md).

## License

MIT.
