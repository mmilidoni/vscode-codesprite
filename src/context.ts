import * as vscode from 'vscode';
import type { PromptContext } from './types';
import { estimateTokens, truncateToTokenBudget } from './tokens';

/**
 * System prompt token overhead estimate.
 * Our system prompts are ~15-30 tokens each. A generous estimate avoids
 * accidentally blowing past the input budget.
 */
const SYSTEM_PROMPT_TOKEN_OVERHEAD = 64;

/**
 * Formatting overhead for the user message template (tags like <PREFIX>, etc.)
 */
const USER_MESSAGE_FORMAT_OVERHEAD = 32;

/**
 * Extracts prefix and suffix text around the cursor position,
 * limited by maxContextLines in each direction, then further trimmed
 * to fit within the token input budget for the model.
 */
export function extractPromptContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  maxContextLines: number,
  maxCompletionTokens: number,
  maxInputTokens: number,
): PromptContext {
  const startLine = Math.max(0, position.line - maxContextLines);
  const endLine = Math.min(document.lineCount - 1, position.line + maxContextLines);

  // Prefix: from startLine up to and including the current line before cursor
  const prefixRange = new vscode.Range(
    startLine,
    0,
    position.line,
    position.character
  );
  let prefix = document.getText(prefixRange);

  // Suffix: from cursor to endLine
  const suffixRange = new vscode.Range(
    position.line,
    position.character,
    endLine,
    document.lineAt(endLine).text.length
  );
  let suffix = document.getText(suffixRange);

  // ── Token budget trimming ──────────────────────────────────────────
  // The budget available for the user message content (prefix + suffix +
  // language tag + format overhead) after subtracting the system prompt,
  // completion tokens, and safety margin.
  const userContentBudget = maxInputTokens - SYSTEM_PROMPT_TOKEN_OVERHEAD - USER_MESSAGE_FORMAT_OVERHEAD;
  const effectiveBudget = Math.max(userContentBudget, 128);

  const prefixTokens = estimateTokens(prefix);
  const suffixTokens = estimateTokens(suffix);
  const totalEstimated = prefixTokens + suffixTokens;

  if (totalEstimated > effectiveBudget) {
    // Allocate budget proportional to each side's size, but ensure each
    // side gets at least 25% so we don't starve one direction entirely.
    const prefixShare = Math.max(
      0.25,
      prefixTokens / Math.max(totalEstimated, 1)
    );
    const suffixShare = 1 - prefixShare;

    const prefixBudget = Math.floor(effectiveBudget * prefixShare);
    const suffixBudget = effectiveBudget - prefixBudget;

    if (prefixTokens > prefixBudget) {
      prefix = truncateToTokenBudget(prefix, prefixBudget, 'start');
    }
    if (suffixTokens > suffixBudget) {
      suffix = truncateToTokenBudget(suffix, suffixBudget, 'end');
    }
  }

  const estimated = estimateTokens(prefix) + estimateTokens(suffix);

  return {
    prefix,
    suffix,
    languageId: document.languageId,
    estimatedTokens: estimated,
  };
}
