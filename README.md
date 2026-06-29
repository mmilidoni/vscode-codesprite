# CodeSprite

> AI ghost text for VS Code. Inline completions, AI commands, and commit messages — bring your own key, open-source.

> ⚠️ **CodeSprite is an early prototype**. Have an idea, found a bug, or want to contribute? Head over to [GitHub](https://github.com/mmilidoni/vscode-codesprite) and open an issue or PR. Feedback welcome.

CodeSprite is a lightweight VS Code extension that adds three AI coding features without locking you into a specific provider. Point it at any OpenAI-compatible chat completions endpoint, supply your own API key, and pick any model your provider supports.

- **Inline completions** — ghost-text suggestions appear as you type, in any language.
- **AI Command modal** — trigger a natural-language instruction (`Ctrl+Shift+I`) and insert or replace code at the cursor.
- **Commit message generator** — one click in the Source Control panel turns your staged diff into a Conventional Commit message.

Built with TypeScript + esbuild. No runtime dependencies. MIT licensed.

## Features

### 1. Inline completions

![Inline completion demo](demo-inline.gif)

Just type. After the configured debounce delay, CodeSprite requests a completion and renders it as ghost text. Press `Tab` to accept. Suggestions are de-duplicated against the code that already follows your cursor, so you never get duplicate lines.

If the status bar shows `$(warning) CS`, no API key is set. If it shows `$(error) CS`, the last request failed — hover for details.

### 2. AI Command modal

![AI Command modal demo](demo-command.gif)

Press `Ctrl+Shift+I` (macOS: `Cmd+Shift+I`) with a text editor focused. Type a natural-language instruction, for example:

- `create a new variable called abc`
- `convert this loop to a list comprehension`
- `add a docstring`

- **No selection** — the generated code is inserted at the cursor.
- **With a selection** — the selected text is replaced with the generated code.

Inserted code is briefly highlighted so you can review it; the highlight clears on the next edit, cursor move, or after 5 seconds. Use `Ctrl+Z` to undo if it's not what you wanted.

### 3. Commit message generator

![Commit message generator demo](demo-commit-message.gif)

Open the Source Control panel (`Ctrl+Shift+G`). Click the sparkle/lightbulb icon in the SCM title bar. CodeSprite reads your staged changes (`git diff --cached`), falls back to unstaged changes if nothing is staged, and writes a Conventional Commit message into the SCM input box.

The commit message prompt extracts a user-story number from the branch name when it follows the `1234-description` pattern, prefixing the message with `[1234]`.

## Quick start

Requires VS Code `^1.80.0` and an API key for an OpenAI-compatible chat completions endpoint.

1. **Install** — search for **CodeSprite** in the Extensions view (`Ctrl+Shift+X`).
2. **Configure** — open Settings (`Ctrl+,`), search for `codesprite`, and set at least:
   ```jsonc
   {
     "codesprite.apiKey": "sk-your-key-here",
     "codesprite.apiBaseUrl": "https://opencode.ai/zen/v1",
     "codesprite.model": "minimax-m2.7"
   }
   ```
3. **Use it** — just type for inline completions, press `Ctrl+Shift+I` for the AI Command modal, or click the sparkle icon in the Source Control panel to generate a commit message.

Click the `CS` indicator in the status bar to toggle all features on/off at once.

### Status bar

A `CS` indicator in the bottom-left status bar reflects the current state:

| Indicator | Meaning |
|-----------|---------|
| `$(lightbulb-autofix) CS` | Enabled (tooltip lists active features) |
| `$(circle-slash) CS` | Globally disabled |
| `$(loading~spin) CS` | A request is in flight |
| `$(warning) CS` | No API key configured |
| `$(error) CS` | Last request failed (hover for the error) |

---

## Configuration

Open Settings (`Ctrl+,`) and search for `codesprite`, or edit your `settings.json` directly.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codesprite.enabled` | boolean | `true` | Master switch for all AI features. Click the status bar item to toggle. |
| `codesprite.inlineEnabled` | boolean | `true` | Enable inline ghost-text completions while typing. |
| `codesprite.commandEnabled` | boolean | `true` | Enable the AI Command modal (`Ctrl+Shift+I`). |
| `codesprite.commitMessageEnabled` | boolean | `true` | Enable the commit message generator in Source Control. |
| `codesprite.commitMaxTokens` | number | `256` | Max tokens the model may generate for a commit message (`16`–`4096`). |
| `codesprite.commitMaxDiffLength` | number | `8000` | Max characters of the git diff sent to the model (`512`–`100000`). Larger diffs are truncated. |
| `codesprite.commitPrompt` | string | _see setting_ | Custom system prompt for commit message generation. The git diff is appended as the user message. Defaults to a conventional commits prompt with detailed formatting guidelines. |
| `codesprite.apiKey` | string | `""` | **Required.** API key for your provider. Keep this secret. |
| `codesprite.apiBaseUrl` | string | `https://opencode.ai/zen/v1` | Base URL for an OpenAI-compatible chat completions endpoint. |
| `codesprite.model` | string | `minimax-m2.7` | Model identifier your provider supports (e.g. `gpt-4o-mini`, `gpt-4o`, `claude-3.5-sonnet`). |
| `codesprite.maxCompletionTokens` | number | `3072` | Max tokens the model may generate per request (`16`–`4096`). |
| `codesprite.maxInputTokens` | number | `3072` | Max tokens for the prompt (prefix + suffix + system message). Context is trimmed to fit (`256`–`32768`). |
| `codesprite.maxContextLines` | number | `10` | Max prefix/suffix lines sent per request. May be lowered to respect `maxInputTokens` (`4`–`500`). |
| `codesprite.streamEarlyStop` | boolean | `true` | Stop reading the SSE stream as soon as completion is signaled, reducing tail latency. |
| `codesprite.enabledLanguages` | string[] | `["*"]` | Language IDs where autocomplete is active. Use `["*"]` for all, or list specific IDs like `["python", "typescript"]`. |
| `codesprite.debounceDelay` | number | `1000` | Milliseconds to wait after typing stops before requesting an inline completion (`50`–`2000`). Lower = more responsive, higher API usage. Inline only. |

### Using a different provider

CodeSprite works with any OpenAI-compatible endpoint. For example, to use OpenAI directly:

```jsonc
{
  "codesprite.apiKey": "sk-...",
  "codesprite.apiBaseUrl": "https://api.openai.com/v1",
  "codesprite.model": "gpt-4o-mini"
}
```

## Installation

### From a `.vsix` package

```bash
code --install-extension codesprite-0.1.0.vsix
```

### From source

```bash
git clone https://github.com/mmilidoni/vscode-codesprite.git
cd vscode-codesprite
npm install
npm run package      # produces a .vsix in the project root
code --install-extension *.vsix
```

## Build from source

```bash
npm install
npx tsc --noEmit        # type-check (esbuild does NOT run tsc)
npm run build           # bundle to dist/extension.js with sourcemaps
npm run watch           # rebuild on change
npm run vscode:prepublish   # production minified bundle
npm run package         # production bundle + .vsix
```

**Type-check first, build second.** A clean build does not guarantee type safety — esbuild strips types without checking them. Always run `npx tsc --noEmit` before committing.

Press `F5` in VS Code to launch the extension host (runs the default build task, then opens a new window with CodeSprite loaded).

## Architecture

Single entrypoint: `src/extension.ts` → `activate()` wires up the three features. Each feature owns its own abort controller and shares a single status bar item.

| Module | Role |
|--------|------|
| `api.ts` | All HTTP calls. `_fetchAiCompletion()` is the single shared pipeline; three thin public wrappers configure it. |
| `config.ts` | Reads VS Code settings, feature toggles, language filtering. |
| `context.ts` | Extracts prefix/suffix around the cursor with token-budget trimming. |
| `tokens.ts` | Char-based token estimation (~4 chars/token) and budget clamping. |
| `debounce.ts` | Cancellable delay for inline typing debounce. |
| `types.ts` | Shared interfaces for requests, responses, and config. |
| `errors.ts` | `getErrorMessage()` — canonical error normalization. |
| `statusBar.ts` | `resetStatusBarToReady()` — canonical status bar reset. |
| `provider.ts` | Inline completion provider (typing trigger). |
| `commandHandler.ts` | AI Command modal (`Ctrl+Shift+I`). |
| `commitMessage.ts` | Commit message generator (SCM title bar trigger). |

All HTTP traffic flows through one streaming pipeline that auto-detects SSE vs. JSON responses, supports early stream termination, and handles servers that omit `Content-Type`. See [`AGENTS.md`](./AGENTS.md) for the full contributor guide and gotchas.

## Privacy

CodeSprite sends the code around your cursor (prefix + suffix, trimmed to your configured token budget) and your natural-language instructions to the API endpoint you configure. No telemetry is collected by the extension itself. Review your provider's data policy before use.

## License

[MIT](./LICENSE) © mmilidoni
