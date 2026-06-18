import * as vscode from 'vscode';
import { getErrorMessage } from './errors';
import { resetStatusBarToReady } from './statusBar';
import { execFile } from 'child_process';
import { getExtensionConfig, isGloballyEnabled, isCommitMessageEnabled } from './config';
import { fetchCommitMessage } from './api';

/**
 * Module-level AbortController for cancelling a previous in-flight request.
 */
let currentCommitAbort: AbortController | undefined;

/**
 * Returns the staged diff for the current workspace folder using `git diff --cached`.
 * Falls back to `git diff` if nothing is staged (generates message from unstaged changes).
 */
function getStagedDiff(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // First try staged changes
    execFile('git', ['diff', '--cached', '--no-color'], { cwd, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error(`git diff --cached failed: ${err.message}`));
        return;
      }
      if (stdout.trim().length > 0) {
        resolve(stdout);
        return;
      }
      // No staged changes — try unstaged as a fallback
      execFile('git', ['diff', '--no-color'], { cwd, maxBuffer: 1024 * 1024 }, (err2, stdout2) => {
        if (err2) {
          reject(new Error(`git diff failed: ${err2.message}`));
          return;
        }
        if (stdout2.trim().length === 0) {
          resolve('');
          return;
        }
        resolve(stdout2);
      });
    });
  });
}

/**
 * Gets the working directory for the current workspace.
 */
function getWorkspaceCwd(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}

/**
 * Registers the "Generate Commit Message" command.
 * Appears as a sparkle icon in the Source Control title bar.
 * Reads staged changes, calls the AI model, and writes the result
 * into the SCM commit message input box.
 */
export function registerCommitMessageCommand(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem
): void {
  const command = vscode.commands.registerCommand(
    'codesprite.generateCommitMessage',
    async () => {
      // 1. Quick rejection checks
      if (!isGloballyEnabled()) {
        vscode.window.showWarningMessage('CodeSprite is currently disabled.');
        return;
      }

      if (!isCommitMessageEnabled()) {
        vscode.window.showWarningMessage(
          'AI commit message generation is disabled. Enable it in settings (codesprite.commitMessageEnabled).'
        );
        return;
      }

      const config = getExtensionConfig();
      if (!config.apiKey) {
        vscode.window.showErrorMessage(
          'CodeSprite: No API key configured. Set codesprite.apiKey in settings.'
        );
        return;
      }

      const cwd = getWorkspaceCwd();
      if (!cwd) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }

      // 2. Get the staged diff
      let diff: string;
      try {
        statusBarItem.text = '$(loading~spin) CS';
        statusBarItem.tooltip = 'CodeSprite: Reading staged changes...';

        diff = await getStagedDiff(cwd);
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        vscode.window.showErrorMessage(`CodeSprite: ${message}`);
        resetStatusBarToReady(statusBarItem);
        return;
      }

      if (diff.trim().length === 0) {
        vscode.window.showInformationMessage(
          'No staged or unstaged changes found. Stage some files first.'
        );
        resetStatusBarToReady(statusBarItem);
        return;
      }

      // 3. Cancel any previous in-flight request
      if (currentCommitAbort) {
        currentCommitAbort.abort();
      }
      const abortController = new AbortController();
      currentCommitAbort = abortController;

      // 4. Truncate diff if too large (keep it under ~8000 chars for the prompt)
      const MAX_DIFF_LENGTH = 8000;
      const truncatedDiff = diff.length > MAX_DIFF_LENGTH
        ? diff.slice(0, MAX_DIFF_LENGTH) + '\n... (diff truncated)'
        : diff;

      // 5. Call the API
      statusBarItem.text = '$(loading~spin) CS ⌛';
      statusBarItem.tooltip = 'CodeSprite: Generating commit message...';

      try {
        const response = await fetchCommitMessage(
          {
            apiKey: config.apiKey,
            apiBaseUrl: config.apiBaseUrl,
            model: config.model,
            diff: truncatedDiff,
            maxTokens: 256,
            streamEarlyStop: config.streamEarlyStop,
          },
          abortController.signal
        );

        if (abortController.signal.aborted) {
          return;
        }

        if (!response.text) {
          vscode.window.showInformationMessage('CodeSprite: Empty response from model.');
          return;
        }

        // 6. Write the commit message into the SCM input box
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) {
          vscode.window.showErrorMessage('Git extension not available.');
          return;
        }

        const gitApi = await gitExtension.activate();
        const api = gitApi as { getAPI: (range: number) => unknown };
        const git = api.getAPI(1) as {
          repositories: Array<{
            inputBox: { value: string };
          }>;
        };

        if (!git.repositories || git.repositories.length === 0) {
          vscode.window.showWarningMessage('No Git repository found.');
          return;
        }

        // Use the first repository
        git.repositories[0].inputBox.value = response.text;
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          return;
        }
        const message = getErrorMessage(err);
        vscode.window.showErrorMessage(`CodeSprite: ${message}`);
      } finally {
        resetStatusBarToReady(statusBarItem);
        if (currentCommitAbort === abortController) {
          currentCommitAbort = undefined;
        }
      }
    }
  );

  context.subscriptions.push(command);
}