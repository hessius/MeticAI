import { APIError } from '@/types';

export interface FetchOptions extends RequestInit {
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob';
}

/**
 * Enhanced fetch wrapper with timeout, error handling, and type safety
 */
export async function apiFetch<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const { timeout = 30000, responseType, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new APIError(
        `HTTP ${response.status}: ${errorText}`,
        response.status,
        errorText
      );
    }

    // Handle explicit responseType option
    if (responseType === 'blob') {
      return await response.blob() as unknown as T;
    }
    if (responseType === 'text') {
      return await response.text() as unknown as T;
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return await response.json();
    }

    // Auto-detect blob for binary content types
    if (contentType?.includes('application/octet-stream') || contentType?.includes('application/zip')) {
      return await response.blob() as unknown as T;
    }

    // For non-JSON responses, return the text
    return await response.text() as unknown as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof APIError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new APIError('Request timeout', 408);
      }
      throw new APIError(error.message);
    }

    throw new APIError('Unknown error occurred');
  }
}

/**
 * Build URL with query parameters
 */
export function buildUrl(
  baseUrl: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  if (!params) return baseUrl;

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/**
 * Create FormData from object, handling File and Blob types
 */
export function createFormData(
  data: Record<string, unknown>
): FormData {
  const formData = new FormData();
  
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    
    if (value instanceof File || value instanceof Blob) {
      formData.append(key, value);
    } else if (typeof value === 'object') {
      formData.append(key, JSON.stringify(value));
    } else {
      formData.append(key, String(value));
    }
  });

  return formData;
}
