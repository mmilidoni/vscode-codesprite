/**
 * Extracts a human-readable message from an unknown error value.
 * Handles both Error instances and non-Error throws (strings, numbers, etc.).
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
