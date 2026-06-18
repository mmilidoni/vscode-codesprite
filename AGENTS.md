# AGENTS.md

## Build & verify

```bash
npx tsc --noEmit       # type-check only (esbuild does NOT run tsc — always do this before committing)
npm run build           # esbuild bundle → dist/extension.js (non-minified, sourcemaps)
npm run vscode:prepublish  # production build (minified, no sourcemaps)
npm run package         # production build + create .vsix
npm run watch           # esbuild watch mode
```

**Order matters.** Type-check first, build second. A clean build does not guarantee type safety.

Press **F5** in VS Code to launch the extension host (runs default build task first, then opens a new window with the extension loaded).

## Architecture

Single entrypoint: `src/extension.ts` → `activate()` wires up three features. Each feature manages its own abort controller and status bar state.

| Feature | File | Trigger |
|---------|------|---------|
| Inline autocomplete | `provider.ts` | Typing in any editor (debounced) |
| AI Command modal | `commandHandler.ts` | `Ctrl+Shift+I` |
| Commit message generator | `commitMessage.ts` | Sparkle icon in SCM title bar |

Shared infrastructure:

| Module | Role |
|--------|------|
| `api.ts` | All HTTP calls — `_fetchAiCompletion()` shared pipeline, 3 thin public wrappers |
| `config.ts` | VS Code settings reads, feature toggles, language filtering |
| `context.ts` | Extracts prefix/suffix around cursor with token budget trimming |
| `tokens.ts` | Char-based token estimation (4 chars ≈ 1 token), budget clamping |
| `debounce.ts` | Cancellable delay for inline typing debounce |
| `types.ts` | Shared interfaces — `ApiCredentials` base extended by 3 request types |
| `errors.ts` | `getErrorMessage(err)` — use everywhere, never inline `err instanceof Error` |
| `statusBar.ts` | `resetStatusBarToReady(item)` — use everywhere, never inline `'$(sparkle) AI'` |

## Gotchas

- **No type-check in build**: esbuild strips types and bundles. Always run `npx tsc --noEmit` separately. A passing build says nothing about type correctness.
- **No tests**: there is zero test infrastructure. Manual F5 verification is the only safety net.
- **`dist/` is .gitignored** but `package.json` points `main` there. The extension won't activate without a built `dist/extension.js`.
- **`vscode` is external**: esbuild leaves `vscode` imports unresolved — they resolve at runtime inside the extension host.
- **Token clamping varies by feature**: verbose warnings for inline, silent for instruction, off for commit message. If adding a new feature, choose intentionally — don't copy blindly.
- **Abort controllers are module-level**: each feature file owns its `current*Abort` variable. No shared request queue or dedup across features.
- **Status bar item is shared**: created once in `extension.ts` and passed by reference to all three features. Don't create a second one.
- **`.vscodeignore` strips everything except `dist/extension.js` and `package.json`**: source files, config, and lockfile don't ship in the .vsix.
- **Node 18 target** in esbuild. VS Code ^1.80.0 engine. Don't use Node 20+ APIs.
- **No duplicated code**: this codebase was aggressively de-duplicated. `_fetchAiCompletion()` in `api.ts` is the single shared HTTP pipeline — add new API call patterns as config on that pipeline, never copy the fetch/SFF/JSON logic. `getErrorMessage()` and `resetStatusBarToReady()` are the canonical utilities; never inline `err instanceof Error` or `'$(sparkle) AI'`.
