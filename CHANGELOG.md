# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.6] - 2026-06-30

### Added
- Multi-provider support via a new `codesprite.provider` setting with six
  built-in presets (`openai`, `anthropic`, `gemini`, `mistral`, `xai`, `custom`),
  each with the correct API URL, auth method, request format, and context
  window. BYOK for any OpenAI-compatible endpoint (OpenRouter, Together,
  Ollama, etc.) via the `custom` preset.
- Per-provider defaults surfaced in the Settings UI (`markdownDescription`
  tables on `apiBaseUrl` and `model`) and in a new README "Providers"
  section with setup examples for Gemini, Anthropic, and Ollama.

### Changed
- `openai` preset defaults to `opencode.ai/zen/v1` + `minimax-m2.7`,
  matching pre-multi-provider behavior — no settings migration required.
- Settings UI reordered: provider, apiKey, apiBaseUrl, model, streamEarlyStop.

## [0.1.5] - 2026-06-29

### Changed
- Default API base URL: `api.opencode.ai/v1` → `opencode.ai/zen/v1`
  (preparatory for upcoming multi-provider support); early-prototype
  warning added to README.

## [0.1.4] - 2026-06-19

### Added
- Current git branch included in commit-message prompt.

## [0.1.3] - 2026-06-19

### Changed
- Default budgets tightened: `debounceDelay` 1000→500 ms,
  `maxInputTokens`/`maxCompletionTokens` 3072→1000 (inline and command);
  `commitMaxTokens` 256→1000, `commitMaxDiffLength` 8000→10000. README
  restructured.

## [0.1.2] - 2026-06-18

### Added
- Per-feature configuration sections in settings (Inline, Command, Commit)
  with separate token budgets and language filters; customizable
  `commitPrompt` plus `commitMaxTokens` and `commitMaxDiffLength` settings.
- Demo GIFs in README for each of the three features.

## [0.1.1] - 2026-06-18

### Added
- Demo GIFs in README for inline completion, AI Command modal, and commit
  message generation.

## [0.1.0] - 2026-06-18

### Added
- Initial release: inline ghost-text autocomplete, AI Command modal
  (`Ctrl+Shift+I`), and a commit message generator in the SCM title bar.
  BYOK against an OpenAI-compatible endpoint, with a status bar indicator
  and VS Code settings for all major options.
