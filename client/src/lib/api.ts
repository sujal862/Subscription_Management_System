import type { ApiResponse } from '../../../shared/contracts';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const SESSION_EXPIRED_EVENT = 'brightloop:session-expired';
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${url}`, { ...options, credentials: 'same-origin', headers });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach Brightloop. Check your connection and try again.');
  }
  if (response.status === 401 && !url.startsWith('/auth/') && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  let result: ApiResponse<T>;
  try { result = await response.json() as ApiResponse<T>; }
  catch { throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response. Please try again.'); }
  if (result && typeof result === 'object' && 'error' in result) throw new ApiError(response.status, result.error.code, result.error.message);
  if (!response.ok) throw new ApiError(response.status, 'REQUEST_FAILED', 'The request could not be completed');
  if (!result || typeof result !== 'object' || !('data' in result)) throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response. Please try again.');
  return result.data;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong';
