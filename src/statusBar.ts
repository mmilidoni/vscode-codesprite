import * as vscode from 'vscode';

/**
 * Resets the status bar item to the default "ready" state.
 */
export function resetStatusBarToReady(statusBarItem: vscode.StatusBarItem): void {
  statusBarItem.text = '$(lightbulb-autofix) CS';
  statusBarItem.tooltip = 'CodeSprite: Ready';
}
