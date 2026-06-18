import * as vscode from 'vscode';
import { AIInlineCompletionProvider } from './provider';
import { isGloballyEnabled, isInlineEnabled, isCommandEnabled, isCommitMessageEnabled } from './config';
import { registerAICommand } from './commandHandler';
import { registerCommitMessageCommand } from './commitMessage';

let statusBarItem: vscode.StatusBarItem;

/**
 * Updates the status bar to reflect the current enabled state.
 * Shows specific feature status in the tooltip.
 */
function syncStatusBarState(): void {
  const enabled = isGloballyEnabled();
  if (!enabled) {
    statusBarItem.text = '$(circle-slash) CS';
    statusBarItem.tooltip = 'CodeSprite: Disabled';
    statusBarItem.color = undefined;
    return;
  }

  const inline = isInlineEnabled();
  const command = isCommandEnabled();
  const commitMsg = isCommitMessageEnabled();
  const parts: string[] = [];
  if (inline) parts.push('Inline');
  if (command) parts.push('Command');
  if (commitMsg) parts.push('Commit');

  statusBarItem.text = '$(lightbulb-autofix) CS';
  statusBarItem.tooltip = `CodeSprite: ${parts.join(' + ') || 'No features enabled'}`;
  statusBarItem.color = undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  // Status bar item — always visible in the bottom-left status area.
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'codesprite.toggle';
  syncStatusBarState();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register the inline completion provider for all document types.
  // The provider itself checks per-language enablement via settings.
  const provider = new AIInlineCompletionProvider(statusBarItem);
  const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );
  context.subscriptions.push(providerDisposable);

  // Toggle command — flips the global enabled flag.
  const toggleCommand = vscode.commands.registerCommand(
    'codesprite.toggle',
    async () => {
      const cfg = vscode.workspace.getConfiguration('codesprite');
      const current = cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `CodeSprite ${!current ? 'enabled' : 'disabled'}`
      );
      syncStatusBarState();
    }
  );
  context.subscriptions.push(toggleCommand);

  // Register the AI Command — opens an input box for natural-language instructions.
  registerAICommand(context, statusBarItem);

  // Register the commit message generator — sparkle icon in Source Control title bar.
  registerCommitMessageCommand(context, statusBarItem);
}

export function deactivate(): void {
  // All disposables are tracked in context.subscriptions and auto-disposed.
  // The in-flight AbortController in provider.ts will also be GC'd.
}
