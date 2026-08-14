# Official Novel Learning Loop

Updated: 2026-08-13

## Delivered

- Every completed official-API script optimization creates an immutable experiment record linking the source audio/script version to the generated audio/script version.
- Experiments are evaluated at 24 hours, 72 hours, and 7 days. Each window is written once and remains auditable.
- Evaluation compares candidate and baseline retention/watch-quality evidence without imposing a hard minimum-sample exclusion. Low-volume evidence lowers confidence instead of disappearing.
- Repeated outcomes are aggregated into a persistent pattern library with `testing`, `promoted`, and `demoted` states.
- Promoted, demoted, and active patterns are passed into the official operation prompt. Deterministic content diagnosis still decides whether a rewrite is allowed.
- State is stored at `<workDir>/official-novel-learning.json`; original scripts are never overwritten.

## Model Provider Switch

Default behavior remains the local Codex SDK:

```text
OPERATION_MODEL_PROVIDER=codex-sdk
```

The SOL calls can later move to an OpenAI-compatible third-party service without changing strategy code:

```text
OPERATION_MODEL_PROVIDER=openai-compatible
OPERATION_MODEL_ENDPOINT=https://provider.example/v1/chat/completions
OPERATION_MODEL_API_KEY=...
OPERATION_MODEL_HEADERS_JSON={"X-Custom-Header":"value"}
```

The adapter sends the existing model name, messages, reasoning effort, and JSON schema. The provider must return a Chat-Completions-compatible `choices[0].message.content` value.

## Main Files

- `scripts/novel-learning-loop.js`
- `scripts/novel-learning-service.js`
- `scripts/brain-model-provider.js`
- `scripts/operation-brain.js`
- `scripts/codex-brain.js`
- `scripts/server.js`

## Safety Boundary

Pattern promotion never bypasses current-video evidence. A promoted pattern is a reusable prior; a demoted pattern is a warning; an active experiment remains unproven. Every new rewrite must still pass the deterministic rewrite gate and change one controlled variable.
