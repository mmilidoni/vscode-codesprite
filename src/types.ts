// ── Provider types (shared by providers.ts) ──

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'xai' | 'custom';

export type Protocol = 'openai' | 'anthropic' | 'gemini';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  protocol: Protocol;
  defaultBaseUrl: string;
  defaultModel: string;
  contextWindow: number;
}

// ── Editor context ──

/**
 * Data collected from the editor before making an API request.
 */
export interface PromptContext {
  /** Code before the cursor position */
  prefix: string;
  /** Code after the cursor position */
  suffix: string;
  /** VS Code language identifier (e.g. "python", "typescript") */
  languageId: string;
  /** Estimated token count of the full prompt (prefix + suffix) */
  estimatedTokens: number;
}

/**
 * Shared API credentials and configuration fields
 * common to all completion request types.
 */
export interface ApiCredentials {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API endpoint */
  apiBaseUrl: string;
  /** Model identifier to use */
  model: string;
  /** Stop reading stream immediately when completion is done */
  streamEarlyStop: boolean;
  /** Provider preset that determines the API protocol, auth, and response parsing */
  provider: ProviderSpec;
  /** Model context window in tokens (used for prompt budget clamping) */
  contextWindow: number;
}

/**
 * Parameters for the API client call.
 */
export interface CompletionRequest extends ApiCredentials {
  /** Code before the cursor */
  prefix: string;
  /** Code after the cursor */
  suffix: string;
  /** VS Code language identifier */
  languageId: string;
  /** Maximum tokens to generate */
  maxTokens: number;
  /** Maximum tokens allowed for the input (prompt) side */
  maxInputTokens: number;
}

/**
 * Successful API response after parsing.
 */
export interface CompletionResponse {
  /** The raw text to insert at the cursor */
  text: string;
  /** Why the model stopped generating (e.g. "stop", "length") */
  finishReason: string;
}

/**
 * Parameters for an instruction-based API call (AI Command modal).
 * The user provides a natural-language instruction and the model
 * returns source code to insert at the cursor.
 */
export interface InstructionRequest extends ApiCredentials {
  /** The user's natural-language instruction (e.g. "create a variable called abc") */
  instruction: string;
  /** Text currently selected in the editor, if any. Empty string when no selection. */
  selectedText: string;
  /** Code before the cursor (or before the selection start) */
  prefix: string;
  /** Code after the cursor (or after the selection end) */
  suffix: string;
  /** VS Code language identifier */
  languageId: string;
  /** Maximum tokens to generate */
  maxTokens: number;
  /** Maximum tokens allowed for the input (prompt) side */
  maxInputTokens: number;
}

/**
 * Parameters for a commit message generation request.
 * Sends a git diff to the model and receives a commit message.
 */
export interface CommitMessageRequest extends ApiCredentials {
  /** The git diff (staged or unstaged) to generate a message from */
  diff: string;
  /** Current git branch name; empty string when unavailable (detached HEAD / git error) */
  branch: string;
  /** Maximum tokens to generate */
  maxTokens: number;
  /** System prompt instructing the model how to format the commit message */
  systemPrompt: string;
}

/**
 * Typed representation of all extension settings.
 */
export interface ExtensionConfig {
  /** Global on/off toggle (master switch) */
  enabled: boolean;
  /** Whether inline autocomplete suggestions are active */
  inlineEnabled: boolean;
  /** Whether the AI Command modal (Ctrl+Shift+I) is active */
  commandEnabled: boolean;
  /** Whether the commit message generator is active */
  commitMessageEnabled: boolean;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  /** Inline: enabled language IDs */
  inlineEnabledLanguages: string[];
  /** Inline: debounce delay in ms */
  debounceDelay: number;
  /** Inline: max context lines around cursor */
  inlineMaxContextLines: number;
  /** Inline: max tokens the model may generate */
  inlineMaxCompletionTokens: number;
  /** Inline: max tokens for the prompt input */
  inlineMaxInputTokens: number;
  /** Command: enabled language IDs */
  commandEnabledLanguages: string[];
  /** Command: max context lines around cursor */
  commandMaxContextLines: number;
  /** Command: max tokens the model may generate */
  commandMaxCompletionTokens: number;
  /** Command: max tokens for the prompt input */
  commandMaxInputTokens: number;
  /** Shared: stop SSE stream early on completion */
  streamEarlyStop: boolean;
  /** Commit: max tokens the model may generate */
  commitMaxTokens: number;
  /** Commit: max characters of git diff to send */
  commitMaxDiffLength: number;
  /** Commit: custom system prompt for commit message generation */
  commitPrompt: string;
  /** Selected provider preset */
  provider: ProviderId;
  /** Model context window in tokens from the active provider preset */
  contextWindow: number;
  /** Provider default model (used when model is not explicitly set) */
  defaultModel: string;
} 
