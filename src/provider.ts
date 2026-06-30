import * as vscode from 'vscode';
import { getErrorMessage } from './errors';
import { resetStatusBarToReady } from './statusBar';
import { delayWithCancellation } from './debounce';
import { extractPromptContext } from './context';
import { getExtensionConfig, isInlineLanguageEnabled, isGloballyEnabled, isInlineEnabled } from './config';
import { fetchCompletion, dedupCompletion } from './api';
import { getProviderSpec } from './providers';
import type { CompletionRequest } from './types';

/**
 * Module-level AbortController so we can cancel the previous in-flight
 * request when a new completion is requested (belt-and-suspenders
 * alongside the VS Code CancellationToken).
 */
let currentAbortController: AbortController | undefined;

export class AIInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private _statusBarItem: vscode.StatusBarItem;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this._statusBarItem = statusBarItem;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const t0 = performance.now();
    const log = (label: string, start: number) => {
      console.log(`[CodeSprite] ${label}: +${(performance.now() - start).toFixed(1)}ms (total ${(performance.now() - t0).toFixed(1)}ms)`);
    };

    // 1. Quick rejection checks — bail fast if disabled or misconfigured.
    if (!isGloballyEnabled() || !isInlineEnabled()) {
      return undefined;
    }
    if (!isInlineLanguageEnabled(document.languageId)) {
      return undefined;
    }

    const config = getExtensionConfig();
    if (!config.apiKey) {
      this._setStatusBar('nokey');
      return undefined;
    }

    console.log(`[CodeSprite] ▶ completion request — lang=${document.languageId} model=${config.model}`);

    // 2. Debounce — wait configured ms, cancellable if user keeps typing.
    const tDebounceStart = performance.now();
    try {
      await delayWithCancellation(config.debounceDelay, token);
    } catch {
      // Debounce cancelled — user typed before delay elapsed.
      return undefined;
    }
    log('debounce done', tDebounceStart);

    // 3. Cancel any previous in-flight request.
    if (currentAbortController) {
      currentAbortController.abort();
    }
    const abortController = new AbortController();
    currentAbortController = abortController;

    // Tie the VS Code CancellationToken to our AbortController.
    const cancelDisposable = token.onCancellationRequested(() => {
      abortController.abort();
    });

    // 4. Extract context from the editor.
    const tContextStart = performance.now();
    const promptContext = extractPromptContext(
      document,
      position,
      config.inlineMaxContextLines,
      config.inlineMaxCompletionTokens,
      config.inlineMaxInputTokens,
    );
    log('context extracted', tContextStart);
    console.log(`[CodeSprite]   prefix lines: ${promptContext.prefix.split('\n').length}, suffix lines: ${promptContext.suffix.split('\n').length}, est. tokens: ${promptContext.estimatedTokens}`);

    // 5. Build the API request.
    const tBuildStart = performance.now();
    const request: CompletionRequest = {
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
      prefix: promptContext.prefix,
      suffix: promptContext.suffix,
      languageId: promptContext.languageId,
      model: config.model,
      maxTokens: config.inlineMaxCompletionTokens,
      maxInputTokens: config.inlineMaxInputTokens,
      streamEarlyStop: config.streamEarlyStop,
      provider: getProviderSpec(config.provider),
      contextWindow: config.contextWindow,
    };
    log('request built', tBuildStart);

    // 6. Call the API.
    this._setStatusBar('requesting');

    try {
      const tFetchStart = performance.now();
      const response = await fetchCompletion(request, abortController.signal);
      log('API fetch complete', tFetchStart);

      // If cancelled during the fetch, discard the result.
      if (token.isCancellationRequested || abortController.signal.aborted) {
        this._setStatusBar('ready');
        return undefined;
      }

      this._setStatusBar('ready');

      // ── Client-side dedup: strip lines that duplicate the suffix ──
      // The model only sees the prefix, so it may generate code that
      // already exists after the cursor. Remove any trailing overlap
      // before presenting the suggestion.
      let dedupedText = response.text;
      if (promptContext.suffix) {
        dedupedText = dedupCompletion(response.text, promptContext.suffix);
      }

      if (!dedupedText) {
        console.log("response", response);
        console.log(`[CodeSprite] ✖ empty response — total ${(performance.now() - t0).toFixed(1)}ms`);
        if (response.finishReason === 'length') {
          console.log(
            `[CodeSprite] ⚠ The model was cut off before producing output (finishReason='length'). ` +
            `Try increasing codesprite.inlineMaxCompletionTokens (current: ${config.inlineMaxCompletionTokens}) ` +
            `or reducing codesprite.inlineMaxContextLines (current: ${config.inlineMaxContextLines}). ` +
            `Prompt context was ~${promptContext.estimatedTokens} tokens.`
          );
        }
        return undefined;
      }

      if (response.finishReason === 'length') {
        console.log(
          `[CodeSprite] ⚠ Completion truncated (finishReason='length'). ` +
          `The model ran out of tokens. Consider increasing codesprite.inlineMaxCompletionTokens ` +
          `(current: ${config.inlineMaxCompletionTokens}) or reducing inlineMaxContextLines.`
        );
      }

      console.log(`[CodeSprite] ✔ completion text length=${dedupedText.length} finishReason=${response.finishReason}`);

      // 7. Create the inline completion item.
      // Empty range at cursor = pure insertion (no text replaced).
      const item = new vscode.InlineCompletionItem(
        dedupedText,
        new vscode.Range(position, position)
      );

      log('inline item created', tFetchStart);
      return [item];
    } catch (err: unknown) {
      if (abortController.signal.aborted || token.isCancellationRequested) {
        this._setStatusBar('ready');
        return undefined;
      }

      const message = getErrorMessage(err);
      this._setStatusBar('error', message);
      console.error('[CodeSprite] API error:', message);
      return undefined; // Swallow — never crash the extension.
    } finally {
      cancelDisposable.dispose();
      if (currentAbortController === abortController) {
        currentAbortController = undefined;
      }
    }
  }

  private _setStatusBar(
    state: 'ready' | 'requesting' | 'error' | 'nokey',
    detail?: string
  ): void {
    switch (state) {
      case 'ready':
        resetStatusBarToReady(this._statusBarItem);
        this._statusBarItem.color = undefined;
        break;
      case 'requesting':
        this._statusBarItem.text = '$(loading~spin) CS';
        this._statusBarItem.tooltip = 'CodeSprite: Requesting...';
        this._statusBarItem.color = undefined;
        break;
      case 'error':
        this._statusBarItem.text = '$(error) CS';
        this._statusBarItem.tooltip = detail
          ? `CodeSprite: Error — ${detail}`
          : 'CodeSprite: Error';
        this._statusBarItem.color = new vscode.ThemeColor('errorForeground');
        break;
      case 'nokey':
        this._statusBarItem.text = '$(warning) CS';
        this._statusBarItem.tooltip =
          'CodeSprite: No API key configured. Set codesprite.apiKey in settings.';
        this._statusBarItem.color = new vscode.ThemeColor('editorWarning.foreground');
        break;
    }
  }
}
