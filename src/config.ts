import * as vscode from 'vscode';
import type { ExtensionConfig } from './types';

const SECTION = 'codesprite';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

/**
 * Reads all extension settings and returns a typed config object.
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
    enabledLanguages: c.get<string[]>('enabledLanguages', ['*']),
    debounceDelay: c.get<number>('debounceDelay', 150),
    maxContextLines: c.get<number>('maxContextLines', 60),
    maxCompletionTokens: c.get<number>('maxCompletionTokens', 256),
    maxInputTokens: c.get<number>('maxInputTokens', 3072),
    streamEarlyStop: c.get<boolean>('streamEarlyStop', true),
  };
}

/**
 * Returns true if the given languageId is enabled by user settings.
 * The value ['*'] means "enabled for all languages".
 */
export function isLanguageEnabled(languageId: string): boolean {
  const languages = cfg().get<string[]>('enabledLanguages', ['*']);
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
