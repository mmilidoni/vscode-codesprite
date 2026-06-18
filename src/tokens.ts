/**
 * Token estimation utilities for managing prompt context budget.
 *
 * We use a character-based heuristic (4 chars ≈ 1 token) which is a
 * reasonable approximation across most tokenizers (GPT, Claude, etc.).
 * This is intentionally lightweight — no external tokenizer dependency —
 * because the goal is a budget guardrail, not exact counting.
 */

/** Rough estimate: 4 characters per token on average for source code. */
const CHARS_PER_TOKEN = 4;

/** Default model context window. Most small/medium models use 4096. */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 4096;

/**
 * Safety margin subtracted from the model's context window to account for:
 *  - System prompt tokens (~20-50)
 *  - Message formatting overhead (role tags, etc.)
 *  - Estimation inaccuracy
 */
const CONTEXT_SAFETY_MARGIN = 256;

/**
 * Estimates the number of tokens in a string using a character-based heuristic.
 * 4 characters ≈ 1 token (empirically reasonable for code in English-centric tokenizers).
 */
export function estimateTokens(text: string): number {
  // Count actual non-empty characters more accurately.
  // Most tokenizers treat whitespace as part of tokens.
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Returns the maximum number of tokens we're willing to use for the
 * input (system + user messages), given the model's context window
 * and the desired completion token budget.
 *
 * Formula: contextWindow - completionTokens - safetyMargin
 */
export function computeMaxInputTokens(
  contextWindow: number,
  completionTokens: number
): number {
  const budget = contextWindow - completionTokens - CONTEXT_SAFETY_MARGIN;
  // Never return less than 256 tokens for the prompt — below that,
  // even basic context is useless.
  return Math.max(budget, 256);
}

/**
 * Truncates a string from the beginning to fit within a token budget,
 * preserving the most recent/relevant content (the end of the string).
 *
 * For prefix: we want the lines closest to cursor, so trim from the start.
 * For suffix: we also want the lines closest to cursor, so trim from the end.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  trimFrom: 'start' | 'end'
): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) {
    return text;
  }

  // Budget is in tokens; convert to approximate character budget
  const charBudget = maxTokens * CHARS_PER_TOKEN;

  if (trimFrom === 'start') {
    // Keep the last `charBudget` characters (closest to cursor)
    return text.slice(-charBudget);
  }

  // Keep the first `charBudget` characters (closest to cursor)
  return text.slice(0, charBudget);
}
