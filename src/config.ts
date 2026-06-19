import * as vscode from 'vscode';
import type { ExtensionConfig } from './types';

const SECTION = 'codesprite';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

/**
 * Reads all extension settings and returns a typed config object.
 * New per-feature keys are read first, with old shared keys as fallback
 * for backward compatibility with existing user settings.
 */
export function getExtensionConfig(): ExtensionConfig {
  const c = cfg();
  return {
    enabled: c.get<boolean>('enabled', true),
    inlineEnabled: c.get<boolean>('inlineEnabled', true),
    commandEnabled: c.get<boolean>('commandEnabled', true),
    commitMessageEnabled: c.get<boolean>('commitMessageEnabled', true),
    apiKey: c.get<string>('apiKey', ''),
    apiBaseUrl: c.get<string>('apiBaseUrl', 'https://api.opencode.ai/v1'),
    model: c.get<string>('model', 'gpt-4o-mini'),
    // Inline-specific — fall back to old shared keys if new ones aren't set
    inlineEnabledLanguages: c.get<string[]>('inlineEnabledLanguages') ?? c.get<string[]>('enabledLanguages', ['*']),
    debounceDelay: c.get<number>('debounceDelay') ?? c.get<number>('inlineDebounceDelay', 1000),
    inlineMaxContextLines: c.get<number>('inlineMaxContextLines') ?? c.get<number>('maxContextLines', 10),
    inlineMaxCompletionTokens: c.get<number>('inlineMaxCompletionTokens') ?? c.get<number>('maxCompletionTokens', 3072),
    inlineMaxInputTokens: c.get<number>('inlineMaxInputTokens') ?? c.get<number>('maxInputTokens', 3072),
    // Command-specific — fall back to old shared keys if new ones aren't set
    commandEnabledLanguages: c.get<string[]>('commandEnabledLanguages') ?? c.get<string[]>('enabledLanguages', ['*']),
    commandMaxContextLines: c.get<number>('commandMaxContextLines') ?? c.get<number>('maxContextLines', 10),
    commandMaxCompletionTokens: c.get<number>('commandMaxCompletionTokens') ?? c.get<number>('maxCompletionTokens', 3072),
    commandMaxInputTokens: c.get<number>('commandMaxInputTokens') ?? c.get<number>('maxInputTokens', 3072),
    // Shared
    streamEarlyStop: c.get<boolean>('streamEarlyStop', true),
    // Commit
    commitMaxTokens: c.get<number>('commitMaxTokens', 256),
    commitMaxDiffLength: c.get<number>('commitMaxDiffLength', 8000),
    commitPrompt: c.get<string>('commitPrompt', `You are an expert developer writing a git commit message. You will be given a git diff. Analyze the changes and produce a commit message that follows the Conventional Commits specification (https://www.conventionalcommits.org/).

The message structure should be:

<type>[optional scope]: <short description>

[optional body]

Guidelines:
- Use one of the standard types: feat, fix, chore, docs, style, refactor, perf, test, ci, build, revert.
- Write the short description in the imperative mood (e.g., "add feature" not "added feature"), no capital first letter, no trailing period.
- If the diff introduces a breaking change, append a ! after the type/scope
- If the diff contains multiple distinct logical changes, use a blank line after the summary and list each change as a bullet point in the body.
- Keep the subject line under 72 characters if possible.
- Output only the commit message, without quotes, backticks, or any extra commentary.`),
  };
}

/**
 * Returns true if the given languageId is enabled for inline completion.
 * The value ['*'] means "enabled for all languages".
 */
export function isInlineLanguageEnabled(languageId: string): boolean {
  const languages = cfg().get<string[]>('inlineEnabledLanguages') ?? cfg().get<string[]>('enabledLanguages', ['*']);
  if (languages.length === 1 && languages[0] === '*') {
    return true;
  }
  return languages.includes(languageId);
}

/**
 * Returns true if the given languageId is enabled for the AI Command modal.
 * The value ['*'] means "enabled for all languages".
 */
export function isCommandLanguageEnabled(languageId: string): boolean {
  const languages = cfg().get<string[]>('commandEnabledLanguages') ?? cfg().get<string[]>('enabledLanguages', ['*']);
  if (languages.length === 1 && languages[0] === '*') {
    return true;
  }
  return languages.includes(languageId);
}

/**
 * Returns true if the global toggle is ON (extension-wide enable).
 */
export function isGloballyEnabled(): boolean {
  return cfg().get<boolean>('enabled', true);
}

/**
 * Returns true if inline autocomplete suggestions are enabled.
 */
export function isInlineEnabled(): boolean {
  return cfg().get<boolean>('inlineEnabled', true);
}

/**
 * Returns true if the AI Command modal is enabled.
 */
export function isCommandEnabled(): boolean {
  return cfg().get<boolean>('commandEnabled', true);
}

/**
 * Returns true if the commit message generator is enabled.
 */
export function isCommitMessageEnabled(): boolean {
  return cfg().get<boolean>('commitMessageEnabled', true);
}
