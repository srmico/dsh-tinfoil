# @srmico/dsh-tinfoil-decisions

Typed decision outputs for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
calibrated predicate probabilities, choice distributions, and ordered scores through Tinfoil's
attested `/v1/decisions` endpoint.

## Installation

```sh
# All Tinfoil capabilities:
dsh plugin add @srmico/dsh-tinfoil

# Decisions alone:
dsh plugin add @srmico/dsh-tinfoil-decisions
```

The package is a plugin and a bundle, so a standalone install activates its row. Do not install the
root bundle and this package together; the duplicate row id becomes unaddressable in the Plugins UI.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `decisions` | `input`, 1–64 typed `questions`, optional `model` | Answers in question order, calibrated probabilities, per-question refusals, and token usage. |

Question types:

- `predicate` — probability that a condition is true.
- `choice` — one of 2–26 string or boolean options.
- `score` — ordered levels; the score is the probability-weighted average of the level indices.

The result ends with `usage: <n> tokens`. The tool does not write to `ctx.tokenMeter`; usage is part
of the tool result.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0`, Node `^24.22.1 || >=26.12.1`.
- A profile with `tools`.
- `TINFOIL_API_KEY` in the launch environment or `$DSH_HOME/.env`.

## Configuration

```yaml
- id: tinfoil-decisions
  config:
    model: decision-medium
```

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `TINFOIL_API_KEY` | Environment variable holding the key. |
| `model` | `decision-medium` | `decision-small`, `decision-medium`, or `decision-large`. |
| `maxInputBytes` | `65536` | Input cap; oversized input is rejected, not chunked. |
| `maxQuestions` | `64` | Questions per request. |
| `maxChoices` | `26` | Choices per choice question. |
| `maxScoreLevels` | `26` | Levels per score question. |
| `maxRequestBytes` | `1048576` | Serialized request cap. |
| `maxResponseBytes` | `1048576` | Response cap. |
| `requestTimeoutMs` | `120000` | Deadline, including attestation. |

### Pre-execute gate

The optional gate evaluates predicate rules before matching tool calls execute:

```yaml
- id: tinfoil-decisions
  config:
    gate:
      enabled: true
      onError: deny
      rules:
        - tool: ['write', 'edit']
          question: 'Does this call modify files outside the workspace?'
          threshold: 0.8
          action: ask
```

It is disabled by default, runs after downstream pre-execute handlers, excludes `decisions` by
default, and fails closed through `onError`. A rule whose only pattern is `run_code` is rejected
because the gate intentionally skips that outer call. The gate is advisory, not a security boundary;
it sends the pending tool name and arguments to Tinfoil.

## Security and attestation

Calls use Tinfoil's `SecureClient` with the default attested router and have no proxy, direct, or
self-hosted mode. Provider error bodies are discarded. Input, questions, and raw responses are not
logged; usage is returned in the result. No requests or responses are cached.

## Limitations

- `decisions_file`, image/message input, batch inputs, prompt caching, and runtime model discovery are
  not implemented.
- The tool does not truncate answers; use the host spill policy for unusually large results.
- No automated tests yet.

## Development

Build and typecheck from the repository root; see
[Development](https://github.com/srmico/dsh-tinfoil/blob/main/docs/DEVELOPMENT.md).

## License

MIT.
