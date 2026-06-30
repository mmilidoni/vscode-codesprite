import * as vscode from 'vscode';
import { getErrorMessage } from './errors';
import { resetStatusBarToReady } from './statusBar';
import { extractPromptContext } from './context';
import { getExtensionConfig, isGloballyEnabled, isCommandLanguageEnabled, isCommandEnabled } from './config';
import { fetchInstructionCompletion } from './api';
import { getProviderSpec } from './providers';
import type { InstructionRequest } from './types';

/**
 * Module-level AbortController so we can cancel a previous in-flight
 * instruction request when the user triggers a new one.
 */
let currentInstructionAbort: AbortController | undefined;

/**
 * Decoration type used to highlight AI-inserted code.
 * Created once and reused; the theme color makes it blend
 * naturally with any VS Code theme.
 */
const aiInsertedDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  isWholeLine: false,
});

/**
 * Active state for the highlight auto-clear mechanism.
 * Tracks the disposable listeners and timeout so we can
 * clean everything up atomically.
 */
let activeHighlightCleanup: {
  /** Disposables for document-change and selection-change listeners */
  disposables: vscode.Disposable[];
  /** The auto-clear timeout handle */
  timeout: ReturnType<typeof setTimeout> | undefined;
  /** The editor the highlight was applied to */
  editor: vscode.TextEditor;
  /** Whether cleanup has already run (guards against double-fire) */
  settled: boolean;
} | undefined;

/**
 * Clears the current AI-inserted highlight decoration and
 * disposes all associated listeners/timeouts.
 */
function clearHighlight(): void {
  if (!activeHighlightCleanup) {
    return;
  }
  const { disposables, timeout, editor } = activeHighlightCleanup;
  activeHighlightCleanup.settled = true;

  // Clear the decoration from the editor
  if (editor) {
    try {
      editor.setDecorations(aiInsertedDecoration, []);
    } catch {
      // Editor may have been closed — ignore
    }
  }

  // Dispose all listeners
  for (const d of disposables) {
    d.dispose();
  }

  // Clear the timeout
  if (timeout !== undefined) {
    clearTimeout(timeout);
  }

  activeHighlightCleanup = undefined;
}

/**
 * Applies a temporary highlight to the inserted text range and
 * sets up auto-clear triggers (timeout, document change, selection change).
 */
function highlightInsertedRange(
  context: vscode.ExtensionContext,
  editor: vscode.TextEditor,
  startPosition: vscode.Position,
  insertedText: string
): void {
  // Clear any previous highlight first
  clearHighlight();

  // Compute the end position of the inserted text
  const lines = insertedText.split('\n');
  const endLine = startPosition.line + lines.length - 1;
  const endChar = lines.length === 1
    ? startPosition.character + insertedText.length
    : lines[lines.length - 1].length;
  const endPosition = new vscode.Position(endLine, endChar);

  const range = new vscode.Range(startPosition, endPosition);

  // Apply the decoration
  editor.setDecorations(aiInsertedDecoration, [range]);

  // Set up auto-clear disposables
  const disposables: vscode.Disposable[] = [];

  // Trigger 1: 5-second timeout — always clears eventually
  const timeout = setTimeout(() => {
    clearHighlight();
  }, 5000);

  // Trigger 2: Document change — clear on any edit
  disposables.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === editor.document) {
        clearHighlight();
      }
    })
  );

  // Trigger 3: Selection change — clear when cursor moves away from the range
  disposables.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === editor) {
        const selection = e.selections[0];
        if (selection && !range.contains(selection.active)) {
          clearHighlight();
        }
      }
    })
  );

  activeHighlightCleanup = {
    disposables,
    timeout,
    editor,
    settled: false,
  };
}

/**
 * Registers the "AI Command" feature: a keyboard-shortcut-triggered
 * input box that sends a natural-language instruction to the model
 * and inserts the resulting source code at the cursor.
 */
export function registerAICommand(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem
): void {
  // Ensure the decoration type is disposed when the extension deactivates
  context.subscriptions.push(aiInsertedDecoration);

  const command = vscode.commands.registerCommand(
    'codesprite.aiCommand',
    async () => {
      // 1. Quick rejection checks
      if (!isGloballyEnabled()) {
        vscode.window.showWarningMessage('CodeSprite is currently disabled.');
        return;
      }

      if (!isCommandEnabled()) {
        vscode.window.showWarningMessage('AI Command is currently disabled. Enable it in settings (codesprite.commandEnabled).');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active text editor.');
        return;
      }

      const config = getExtensionConfig();
      if (!config.apiKey) {
        vscode.window.showErrorMessage(
          'CodeSprite: No API key configured. Set codesprite.apiKey in settings.'
        );
        return;
      }

      if (!isCommandLanguageEnabled(editor.document.languageId)) {
        vscode.window.showWarningMessage(
          `CodeSprite is not enabled for language: ${editor.document.languageId}`
        );
        return;
      }

      // 2. Capture the current selection up front. It is used both to
      //    display the selected line number(s) in the modal and to extract
      //    context later. VS Code positions are 0-indexed, but the editor
      //    displays 1-indexed line numbers, so we add 1 for user-facing text.
      const selection = editor.selection;
      let promptLabel = 'AI Instruction';
      if (!selection.isEmpty) {
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        promptLabel = startLine === endLine
          ? `AI Instruction · Line ${startLine} selected`
          : `AI Instruction · Lines ${startLine}–${endLine} selected`;
      }

      // Show the input box, surfacing the selected line number(s) in the prompt
      const instruction = await vscode.window.showInputBox({
        prompt: promptLabel,
        placeHolder: 'e.g. create a new variable called abc',
        title: 'CodeSprite Command',
        ignoreFocusOut: true,
      });

      // User cancelled
      if (!instruction || instruction.trim().length === 0) {
        return;
      }

      // 3. Cancel any previous in-flight instruction request
      if (currentInstructionAbort) {
        currentInstructionAbort.abort();
      }
      const abortController = new AbortController();
      currentInstructionAbort = abortController;

      // 4. Extract context and selected text from the editor
      const selectedText = editor.document.getText(selection);
      // When there's a selection, context starts/ends around the selection bounds
      const position = selection.isEmpty ? selection.active : selection.start;
      const promptContext = extractPromptContext(
        editor.document,
        position,
        config.commandMaxContextLines,
        config.commandMaxCompletionTokens,
        config.commandMaxInputTokens,
      );

      // 5. Build the request
      const request: InstructionRequest = {
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
        model: config.model,
        instruction: instruction.trim(),
        selectedText,
        prefix: promptContext.prefix,
        suffix: promptContext.suffix,
        languageId: promptContext.languageId,
        maxTokens: config.commandMaxCompletionTokens,
        maxInputTokens: config.commandMaxInputTokens,
        streamEarlyStop: config.streamEarlyStop,
        provider: getProviderSpec(config.provider),
        contextWindow: config.contextWindow,
      };

      // 6. Call the API
      statusBarItem.text = '$(loading~spin) CS ⌛';
      statusBarItem.tooltip = 'CodeSprite: Processing instruction...';

      try {
        const response = await fetchInstructionCompletion(request, abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        if (!response.text) {
          vscode.window.showInformationMessage('CodeSprite: Empty response from model.');
          return;
        }

        // 7. Insert the response text at the cursor (or replace selection)
        const rangeToReplace = editor.selection.isEmpty
          ? new vscode.Range(position, position)
          : editor.selection;

        const success = await editor.edit((editBuilder) => {
          editBuilder.replace(rangeToReplace, response.text);
        });

        if (!success) {
          vscode.window.showErrorMessage('CodeSprite: Failed to insert code.');
          return;
        }

        // 8. Highlight the inserted range so the user can see what was added
        //    and easily undo (Ctrl+Z) if desired.
        highlightInsertedRange(context, editor, position, response.text);
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          return;
        }
        const message = getErrorMessage(err);
        vscode.window.showErrorMessage(`CodeSprite: ${message}`);
      } finally {
        // Reset status bar
        resetStatusBarToReady(statusBarItem);
        if (currentInstructionAbort === abortController) {
          currentInstructionAbort = undefined;
        }
      }
    }
  );

  context.subscriptions.push(command);
}