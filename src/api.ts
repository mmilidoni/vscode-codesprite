import type { CompletionRequest, CompletionResponse, InstructionRequest, CommitMessageRequest } from './types';
import { estimateTokens, computeMaxInputTokens, DEFAULT_MODEL_CONTEXT_WINDOW } from './tokens';

/**
 * System prompts — concise and unambiguous.
 *
 * Design rules applied to every prompt:
 *  • Include only what the model MUST know to produce correct output.
 *  • Repeat the "output ONLY" constraint once, clearly.
 *  • Avoid filler ("you are a helpful assistant", "of course", etc.).
 *  • Shorter prompts = lower latency + fewer tokens consumed per request.
 */

// Continuation: model appends to the prefix.
// Suffix is included in the user message as stop-context so the model
// knows what already exists after the cursor and avoids duplicating it.
const SYSTEM_PROMPT =
  //'Continue the code. Output ONLY the continuation — no explanation, no markdown.';
  `You are an expert programming assistant specialized in code completion.  
The user will provide source code split into two sections:

<PREFIX>
// code before the cursor
<SUFFIX>
// code after the cursor

Your job is to interpret the provided code and generate the missing code (the **continuation**) that logically belongs between the PREFIX and the SUFFIX.  

**Rules:**
- Output **only** the continuation code. Do not include the <PREFIX>, <SUFFIX> tags, any surrounding commentary, or markdown fences.
- The continuation must flow naturally from the end of the PREFIX, respecting the language, style, indentation, and logical structure.
- **Never duplicate code** that already appears at the beginning of the SUFFIX. If the SUFFIX starts with text identical to what you would generate, stop your output right before that overlapping part. Use the SUFFIX solely to validate that your suggestion does not repeat the existing suffix.
- If the SUFFIX is empty or contains only whitespace, you may generate a complete, syntactically correct continuation until a natural stopping point (end of statement, block, function, etc.).
- Analyze the PREFIX to infer the programming language, context, and intended structure. Ensure the completion seamlessly connects the PREFIX and SUFFIX.

**Output format:**
Plain text containing exactly the continuation code. No explanations, no backticks, no extra whitespace unless required by the code style.

**Example:**
Input:
<PREFIX>
def greet(name):
    print("Hello, " + 
<SUFFIX>
)

Expected output:
name)

---

Now, complete the following code following the rules above.`

// Instruction (no selection): insert generated code at the cursor.
const SYSTEM_PROMPT_INSTRUCTION =
  'You are a code assistant. Given surrounding code context and an instruction, output ONLY the raw source code to insert. No explanations, no markdown fences, no comments.';

// Instruction (with selection): replace the selected region entirely.
const SYSTEM_PROMPT_INSTRUCTION_SELECTION =
  'You are a code assistant. The user has selected code or comments and given an instruction. Replace the entire selection with your output. Output ONLY the replacement source code. No explanations, no markdown fences, no comments.';

function buildMessages(
  request: CompletionRequest
): Array<{ role: string; content: string }> {
  // Continuation mode: prefix only. The model extends from the cursor.
  // Suffix duplication is handled client-side via dedupCompletion().
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Language: ${request.languageId}\n<PREFIX>\n${request.prefix}\n</PREFIX>`,
    },
  ];
}

function buildInstructionMessages(
  request: InstructionRequest
): Array<{ role: string; content: string }> {
  const hasSelection = request.selectedText.length > 0;

  let userContent = `Language: ${request.languageId}\n\n`;

  if (hasSelection) {
    // Selection path: label each region relative to the selection so the
    // model understands the spatial relationship unambiguously.
    userContent += `Code before selection:\n<PREFIX>\n${request.prefix}\n</PREFIX>\n\n`;
    userContent += `Selected code to replace:\n<SELECTED>\n${request.selectedText}\n</SELECTED>\n\n`;
    userContent += `Code after selection:\n<SUFFIX>\n${request.suffix}\n</SUFFIX>\n\n`;
  } else {
    // No-selection path: label relative to the cursor, not "selection",
    // to avoid confusing the model about what it should operate on.
    userContent += `Code before cursor:\n<PREFIX>\n${request.prefix}\n</PREFIX>\n\n`;
    userContent += `Code after cursor:\n<SUFFIX>\n${request.suffix}\n</SUFFIX>\n\n`;
  }

  userContent += `Instruction: ${request.instruction}`;

  return [
    { role: 'system', content: hasSelection ? SYSTEM_PROMPT_INSTRUCTION_SELECTION : SYSTEM_PROMPT_INSTRUCTION },
    { role: 'user', content: userContent },
  ];
}

function buildCommitMessages(
  request: CommitMessageRequest
): Array<{ role: string; content: string }> {
  return [
    { role: 'system', content: request.systemPrompt },
    { role: 'user', content: `Diff:\n${request.diff}` },
  ];
}

function stripMarkdownFences(text: string): string {
  const fencePattern = /^```[\w]*\n?([\s\S]*?)\n?```$/;
  const match = text.match(fencePattern);
  if (match) {
    return match[1];
  }
  return text;
}

/**
 * Removes trailing lines from the completion that duplicate the start of
 * the suffix. Without seeing the suffix in the prompt, the model may
 * generate code that already exists after the cursor. This strips that
 * overlap so only genuinely new code is inserted.
 */
export function dedupCompletion(completion: string, suffix: string): string {
  if (!completion || !suffix) {
    return completion;
  }

  const completionLines = completion.split('\n');
  const suffixLines = suffix.split('\n');

  // Find the longest trailing segment of the completion that matches
  // the beginning of the suffix. Start from the last line and work
  // backwards to find the maximal overlap.
  let matchLen = 0;
  for (let i = completionLines.length - 1; i >= 0; i--) {
    const candidateLen = completionLines.length - i;
    if (candidateLen > suffixLines.length) {
      break;
    }
    let matches = true;
    for (let j = 0; j < candidateLen; j++) {
      if (completionLines[i + j] !== suffixLines[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      matchLen = candidateLen;
    }
  }

  if (matchLen > 0) {
    const trimmed = completionLines.slice(0, completionLines.length - matchLen).join('\n');
    console.log(`[CodeSprite]   dedup: stripped ${matchLen} overlapping line(s) from completion`);
    return trimmed;
  }

  return completion;
}

/**
 * Parses a streaming SSE (Server-Sent Events) response body.
 * Concatenates content deltas into the final completion text.
 */
async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  earlyStop: boolean
): Promise<{ text: string; finishReason: string }> {

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let finishReason = 'unknown';
  let buffer = '';
  let firstTokenLogged = false;
  const tStreamStart = performance.now();
  let protocolDone = false;

  const handleData = (dataStr: string): void => {
    if (dataStr === '[DONE]') {
      protocolDone = true;
      return;
    }

    try {
      const chunk = JSON.parse(dataStr) as {
        choices?: Array<{
          delta?: { content?: string };
          finish_reason?: string | null;
        }>;
      };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          console.log(`[CodeSprite]   TTFT (first content token): ${(performance.now() - tStreamStart).toFixed(1)}ms`);
        }
      }
      const reason = chunk.choices?.[0]?.finish_reason;
      if (reason) {
        finishReason = reason;
        protocolDone = true;
      }
    } catch {
      // Skip malformed SSE chunks (some providers send comments)
    }
  };

  const processBufferLines = (): void => {
    let start = 0;

    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer.charCodeAt(i);
      if (ch !== 10 && ch !== 13) continue;

      const line = buffer.slice(start, i);

      if (ch === 13 && i + 1 < buffer.length && buffer.charCodeAt(i + 1) === 10) {
        i++;
      }

      start = i + 1;

      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      handleData(trimmed.slice(5).trim());
      if (protocolDone && earlyStop) {
        break;
      }
    }

    buffer = buffer.slice(start);
  };

  try {
    while (true) {
      // Check for cancellation between chunks
      if (signal.aborted) {
        reader.cancel();
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      processBufferLines();

      if (protocolDone && earlyStop) {
        // Some providers send [DONE] / finish_reason but keep socket open briefly.
        // Stop reading immediately to avoid post-completion latency.
        await reader.cancel();
        break;
      }
    }

    // Flush any trailing decoder output and process final complete lines.
    buffer += decoder.decode();
    processBufferLines();
  } finally {
    reader.releaseLock();
  }

  return { text: fullText, finishReason };
}

/**
 * Parameters that vary between the three public API functions.
 * Used by the shared internal pipeline _fetchAiCompletion().
 */
interface AiCompletionParams {
  /** Pre-built messages array (system + user) */
  messages: Array<{ role: string; content: string }>;
  /** API key for Bearer auth */
  apiKey: string;
  /** Base URL for the chat completions endpoint */
  apiBaseUrl: string;
  /** Model identifier */
  model: string;
  /** Maximum tokens to request (may be clamped by the pipeline) */
  maxTokens: number;
  /** Sampling temperature */
  temperature: number;
  /** Whether to stop reading stream immediately after completion signal */
  streamEarlyStop: boolean;
  /** Label used in console log messages (e.g. "Inline completion") */
  logPrefix: string;
  /** Token clamping mode:
   *  - 'verbose': clamp and log warnings (fetchCompletion)
   *  - 'silent': clamp without warnings (fetchInstructionCompletion)
   *  - 'off': use maxTokens as-is, no clamping (fetchCommitMessage) */
  clampTokens: 'verbose' | 'silent' | 'off';
  /** Whether to strip markdown fences from the result text */
  stripMarkdown: boolean;
  /** Whether to emit timing/performance console logs */
  logTiming: boolean;
  /** Whether to log the raw Response object (debug only) */
  logResponse: boolean;
  /** Whether to include maxTokens in the prompt log output */
  logMaxTokensInPrompt: boolean;
}

/**
 * Shared pipeline for all AI completion requests.
 *
 * Strategy for response parsing:
 *  - We always send `stream: true` so the server should respond with SSE.
 *  - We check the Content-Type header first:
 *      • text/event-stream → parse as SSE stream (memory-efficient)
 *      • application/json  → parse as a single JSON object
 *  - If the response isn't a recognized type we attempt SSE, falling back
 *    to JSON on parse failure.  This handles servers that omit Content-Type.
 */
async function _fetchAiCompletion(
  params: AiCompletionParams,
  signal: AbortSignal
): Promise<CompletionResponse> {
  const {
    messages, apiKey, apiBaseUrl, model, maxTokens, temperature,
    streamEarlyStop, logPrefix, clampTokens, stripMarkdown,
    logTiming, logResponse, logMaxTokensInPrompt,
  } = params;

  // --- Optional timing setup ---
  const t0 = logTiming ? performance.now() : 0;
  const log = logTiming
    ? (label: string, start: number) =>
        console.log(`[CodeSprite]   ${label}: +${(performance.now() - start).toFixed(1)}ms (total ${(performance.now() - t0).toFixed(1)}ms)`)
    : (_label: string, _start: number) => { /* no-op */ };

  const tBuild = logTiming ? performance.now() : 0;

  // --- Token clamping ---
  let effectiveMaxTokens: number;
  if (clampTokens === 'off') {
    effectiveMaxTokens = maxTokens;
  } else {
    const promptTokens = estimateTokens(JSON.stringify(messages));
    const maxCompletable = computeMaxInputTokens(DEFAULT_MODEL_CONTEXT_WINDOW, 0) - promptTokens;
    effectiveMaxTokens = Math.min(maxTokens, Math.max(maxCompletable, 16));

    if (clampTokens === 'verbose') {
      if (effectiveMaxTokens < maxTokens) {
        console.log(
          `[CodeSprite] ⚠ max_tokens clamped from ${maxTokens} → ${effectiveMaxTokens} ` +
          `(prompt ~${promptTokens} tokens, only ~${maxCompletable + effectiveMaxTokens} available in context window)`
        );
      }
      if (effectiveMaxTokens < 32) {
        console.log(
          `[CodeSprite] ⚠ SEVERE: effective max_tokens=${effectiveMaxTokens} is very low. ` +
          `The prompt may be too large for the model's context window. ` +
          `Consider reducing maxContextLines or increasing maxInputTokens in settings.`
        );
      }
    }
  }

  // --- Log the prompt ---
  const logData: Record<string, unknown> = { model, messages };
  if (logMaxTokensInPrompt) {
    logData.maxTokens = effectiveMaxTokens;
  }
  console.log(`[CodeSprite] ${logPrefix} prompt sent to model:`, logData);

  // --- Build request body ---
  const body = {
    model,
    messages,
    max_tokens: effectiveMaxTokens,
    temperature,
    stream: true,
  };
  if (logTiming) log('build messages & body', tBuild);

  // --- Fetch ---
  const tFetch = logTiming ? performance.now() : 0;
  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (logTiming) log(`fetch() headers received (status=${response.status})`, tFetch);
  if (logResponse) {
    console.log("response", response);
  }

  // --- Error handling ---
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let errorMessage = errorText;
    try {
      const errJson = JSON.parse(errorText) as { error?: { message?: string } };
      if (errJson.error?.message) {
        errorMessage = errJson.error.message;
      }
    } catch {
      errorMessage = errorText.slice(0, 500) || `HTTP ${response.status}`;
    }
    throw new Error(`AI API error ${response.status}: ${errorMessage}`);
  }

  // --- Content-Type detection ---
  const contentType = response.headers.get('Content-Type') ?? '';
  const isSSE = contentType.includes('text/event-stream');

  // --- SSE streaming path ---
  if (isSSE && response.body) {
    const tSSE = logTiming ? performance.now() : 0;
    const { text, finishReason } = await parseSSEStream(response.body, signal, streamEarlyStop);
    if (logTiming) log('SSE stream complete', tSSE);
    const result = stripMarkdown ? stripMarkdownFences(text.trim()) : text.trim();
    return { text: result, finishReason };
  }

  // --- Non-SSE path: read the full body as text ---
  const tReadBody = logTiming ? performance.now() : 0;
  const raw = await response.text();
  if (logTiming) log('read response body', tReadBody);

  // --- SSE fallback when Content-Type was missing but body starts with "data:" ---
  if (!isSSE && raw.startsWith('data:') && response.body === null) {
    const lines = raw.split(/\r?\n|\r/);
    let fullText = '';
    let finishReason = 'unknown';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const chunk = JSON.parse(dataStr) as {
          choices?: Array<{
            delta?: { content?: string };
            finish_reason?: string | null;
          }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
        }
        const reason = chunk.choices?.[0]?.finish_reason;
        if (reason) {
          finishReason = reason;
        }
      } catch {
        // Skip malformed chunks
      }
    }

    const result = stripMarkdown ? stripMarkdownFences(fullText.trim()) : fullText.trim();
    return { text: result, finishReason };
  }

  // --- Standard JSON response ---
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `AI API returned non-JSON response (Content-Type: ${contentType || 'unknown'}): ${raw.slice(0, 200)}`
    );
  }

  const parsed = data as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
  };

  const choice = parsed.choices?.[0];
  if (!choice) {
    throw new Error('No completion choices returned from API');
  }

  const rawText = (choice.message?.content ?? '').trim();
  const result = stripMarkdown ? stripMarkdownFences(rawText) : rawText;
  return { text: result, finishReason: choice.finish_reason ?? 'unknown' };
}

/**
 * Sends a completion request to the API.
 *
 * Strategy for response parsing:
 *  - We always send `stream: true` so the server should respond with SSE.
 *  - We check the Content-Type header first:
 *      • text/event-stream → parse as SSE stream (memory-efficient)
 *      • application/json  → parse as a single JSON object
 *  - If the response isn't a recognized type we attempt SSE, falling back
 *    to JSON on parse failure.  This handles servers that omit Content-Type.
 */
export async function fetchCompletion(
  request: CompletionRequest,
  signal: AbortSignal
): Promise<CompletionResponse> {
  return _fetchAiCompletion({
    messages: buildMessages(request),
    apiKey: request.apiKey,
    apiBaseUrl: request.apiBaseUrl,
    model: request.model,
    maxTokens: request.maxTokens,
    temperature: 0.1,
    streamEarlyStop: request.streamEarlyStop,
    logPrefix: 'Inline completion',
    clampTokens: 'verbose',
    stripMarkdown: true,
    logTiming: true,
    logResponse: false,
    logMaxTokensInPrompt: true,
  }, signal);
}

/**
 * Sends an instruction-based completion request to the API.
 * Uses the same HTTP + streaming + JSON fallback logic as fetchCompletion,
 * but with a different prompt construction tailored for natural-language instructions.
 */
export async function fetchInstructionCompletion(
  request: InstructionRequest,
  signal: AbortSignal
): Promise<CompletionResponse> {
  return _fetchAiCompletion({
    messages: buildInstructionMessages(request),
    apiKey: request.apiKey,
    apiBaseUrl: request.apiBaseUrl,
    model: request.model,
    maxTokens: request.maxTokens,
    temperature: 0.2,
    streamEarlyStop: request.streamEarlyStop,
    logPrefix: 'AI Command',
    clampTokens: 'silent',
    stripMarkdown: true,
    logTiming: false,
    logResponse: false,
    logMaxTokensInPrompt: false,
  }, signal);
}

/**
 * Sends a commit message generation request to the API.
 * Takes a git diff and returns a suggested commit message.
 */
export async function fetchCommitMessage(
  request: CommitMessageRequest,
  signal: AbortSignal
): Promise<CompletionResponse> {
  return _fetchAiCompletion({
    messages: buildCommitMessages(request),
    apiKey: request.apiKey,
    apiBaseUrl: request.apiBaseUrl,
    model: request.model,
    maxTokens: request.maxTokens,
    temperature: 0.3,
    streamEarlyStop: request.streamEarlyStop,
    logPrefix: 'Commit message',
    clampTokens: 'off',
    stripMarkdown: false,
    logTiming: false,
    logResponse: true,
    logMaxTokensInPrompt: false,
  }, signal);
}