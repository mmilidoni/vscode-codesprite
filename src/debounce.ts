import * as vscode from 'vscode';

/**
 * Returns a Promise that resolves after `ms` milliseconds,
 * or rejects with a CancellationError if the token is triggered.
 */
export function delayWithCancellation(
  ms: number,
  token: vscode.CancellationToken
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // If already cancelled at call time, reject immediately.
    if (token.isCancellationRequested) {
      reject(new vscode.CancellationError());
      return;
    }

    const timer = setTimeout(resolve, ms);

    const disposable = token.onCancellationRequested(() => {
      clearTimeout(timer);
      disposable.dispose();
      reject(new vscode.CancellationError());
    });
  });
}
