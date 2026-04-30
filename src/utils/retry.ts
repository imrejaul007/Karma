// -nocheck
/**
 * Retry utility for external service calls.
 *
 * Provides a simple exponential-backoff retry mechanism for unreliable external HTTP calls.
 */

export interface RetryOptions {
  /** Number of retry attempts after the initial attempt (default: 1) */
  retries?: number;
  /** Base delay in milliseconds between retries (default: 500) */
  delayMs?: number;
}

/**
 * Executes a function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries fail
 *
 * @example
 * const result = await withRetry(() => axios.get('/api/data'), { retries: 2, delayMs: 500 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 1, delayMs = 500 } = options;
  let lastError: unknown;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries) {
        // Exponential backoff: delay * (attempt + 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }

  throw lastError;
}
