## Plan: Highlight Inserted AI Code

### Summary
After the AI Command inserts code into the editor, apply a temporary background highlight decoration to the inserted range so the user can visually identify what was added. The highlight auto-clears when the user types, moves the cursor, or after a 5-second timeout. The user can still undo the insertion with Ctrl+Z because `editor.edit()` pushes onto VS Code's undo stack.

### Files to Modify

| File | Change |
|------|--------|
| `src/commandHandler.ts` | After insertion, compute the inserted range and apply a `TextEditorDecorationType` highlight. Set up auto-clear on next edit or timeout. |

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Highlight mechanism | `vscode.TextEditorDecorationType` with `backgroundColor` | VS Code's native, lightweight decoration API. Purely visual — not part of document content. No webview overhead. |
| Highlight color | `new vscode.ThemeColor('editor.findMatchHighlightBackground')` | Uses the user's existing theme color for search-result highlights, which is always visible and theme-appropriate. Falls back gracefully across dark/light themes. |
| Auto-clear strategy | Clear on: (1) next document change, (2) cursor move away from range, (3) 5-second timeout | Gives user time to see the highlight, but doesn't leave it forever. Three triggers ensure it gets cleared regardless of user behavior. |
| Undo behavior | No change needed — `editor.edit()` already pushes to undo stack | Ctrl+Z will undo the entire insertion in one step, and the decoration is cleared because it's not part of the document. |

### Implementation Steps

1. **Create a decoration type** — Define a module-level `TextEditorDecorationType` with `backgroundColor` set to `editor.findMatchHighlightBackground` theme color and `isWholeLine: false`. Register it as a disposable in `registerAICommand`.

2. **After insertion, compute the inserted range** — After `editor.edit()` succeeds, calculate the range: start at `position`, end at `new vscode.Position(position.line + lineCount - 1, lastLineLength)`. Handle edge case where response is empty string.

3. **Apply the decoration** — Call `editor.setDecorations(decorationType, [new vscode.Range(...)])` with the computed range.

4. **Auto-clear the decoration** — Set up three clear triggers:
   - **Timeout**: `setTimeout(() => clearDecorations(), 5000)` — always clears eventually.
   - **Document change**: Listen to `vscode.workspace.onDidChangeTextDocument` — clear immediately on any edit.
   - **Selection change**: Listen to `vscode.window.onDidChangeTextEditorSelection` — clear if cursor moves away from the highlighted range.
   All three listeners are disposable and pushed to `context.subscriptions`. Use a shared `clearDecorations()` function that also disposes the listeners (so they don't fire repeatedly).

5. **Handle edge cases**:
   - If `editor.edit()` returns `false`, don't apply decorations.
   - If the editor becomes inactive during highlight, clear early.
   - If a new AI command is invoked while a highlight is active, clear the previous highlight first.

### Risks & Mitigations

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Decoration stays visible after closing file | Low | VS Code auto-disposes decorations when editors close. The 5s timeout also guarantees cleanup. |
| Range calculation off for multiline inserts | Low | Calculate end position from number of newlines + last line character offset. Test with multiline responses. |
| Theme color not visible in some themes | Low | `editor.findMatchHighlightBackground` is a core VS Code theme key — always defined. |
| Multiple rapid commands cause stale highlights | Low | Clear any existing highlight before applying a new one (module-level state). |

### Verification

- [ ] Press `Ctrl+Shift+I`, type instruction, press Enter — inserted code is highlighted
- [ ] Highlight disappears after 5 seconds
- [ ] Highlight disappears immediately when user starts typing
- [ ] Highlight disappears when user moves cursor away
- [ ] Ctrl+Z undoes the insertion cleanly (decoration gone, text removed)
- [ ] Multiline responses are fully highlighted (not just first line)
- [ ] Build passes with `npm run build`