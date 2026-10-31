import type { ApiResponse } from '../../../shared/contracts';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...options, credentials: 'same-origin',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const result = await response.json() as ApiResponse<T>;
  if ('error' in result) throw new ApiError(response.status, result.error.code, result.error.message);
  if (!response.ok) throw new ApiError(response.status, 'REQUEST_FAILED', 'The request could not be completed');
  return result.data;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong';
