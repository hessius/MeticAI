import { z } from 'zod';

/**
 * Validate file type
 */
export function validateFileType(
  file: File,
  allowedTypes: string[]
): { valid: boolean; error?: string } {
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Validate file size
 */
export function validateFileSize(
  file: File,
  maxSizeBytes: number
): { valid: boolean; error?: string } {
  if (file.size > maxSizeBytes) {
    const maxSizeMB = (maxSizeBytes / 1024 / 1024).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMB}MB limit`,
    };
  }

  return { valid: true };
}

/**
 * Validate image file
 */
export function validateImageFile(
  file: File,
  options: {
    maxSizeMB?: number;
    allowedTypes?: string[];
  } = {}
): { valid: boolean; errors: string[] } {
  const {
    maxSizeMB = 10,
    allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  } = options;

  const errors: string[] = [];
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const typeValidation = validateFileType(file, allowedTypes);
  if (!typeValidation.valid && typeValidation.error) {
    errors.push(typeValidation.error);
  }

  const sizeValidation = validateFileSize(file, maxSizeBytes);
  if (!sizeValidation.valid && sizeValidation.error) {
    errors.push(sizeValidation.error);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate JSON file
 */
export async function validateJsonFile(
  file: File
): Promise<{ valid: boolean; data?: unknown; error?: string }> {
  const typeValidation = validateFileType(file, ['application/json']);
  if (!typeValidation.valid) {
    return { valid: false, error: typeValidation.error };
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    return { valid: true, data };
  } catch {
    return {
      valid: false,
      error: 'Invalid JSON format',
    };
  }
}

/**
 * Validate form data with schema
 */
export function validateFormData<T>(
  data: unknown,
  schema: z.ZodSchema<T>
): { valid: boolean; data?: T; errors?: z.ZodError } {
  try {
    const validated = schema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, errors: error };
    }
    throw error;
  }
}

/**
 * Format Zod validation errors for display
 */
export function formatValidationErrors(errors: z.ZodError): string[] {
  return errors.errors.map((err) => {
    const path = err.path.join('.');
    return `${path}: ${err.message}`;
  });
}

/**
 * Safe JSON parse with error handling
 */
export function safeJsonParse<T = unknown>(
  text: string,
  fallback?: T
): T | null {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('JSON parse error:', error);
    return fallback !== undefined ? fallback : null;
  }
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate number in range
 */
export function validateNumberInRange(
  value: number,
  min: number,
  max: number
): { valid: boolean; error?: string } {
  if (value < min || value > max) {
    return {
      valid: false,
      error: `Value must be between ${min} and ${max}`,
    };
  }

  return { valid: true };
}
