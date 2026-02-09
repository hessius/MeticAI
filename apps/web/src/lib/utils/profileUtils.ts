import { z } from 'zod';
import { ProfileData, ProfileDataSchema, ValidationError } from '@/types';

/**
 * Extract JSON from markdown code blocks or raw JSON
 */
export function extractJsonFromText(text: string): Record<string, unknown> | null {
  if (!text) return null;

  // Try to find JSON in markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1] : text;

  try {
    return JSON.parse(jsonText.trim());
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    return null;
  }
}

/**
 * Validate and parse profile JSON
 */
export function parseProfile(jsonString: string): ProfileData {
  const jsonData = extractJsonFromText(jsonString);
  
  if (!jsonData) {
    throw new ValidationError('Invalid JSON format');
  }

  try {
    return ProfileDataSchema.parse(jsonData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid profile structure', error);
    }
    throw new ValidationError('Invalid profile structure', error);
  }
}

/**
 * Extract profile name from JSON data
 */
export function extractProfileName(profileJson: string): string {
  try {
    const profile = parseProfile(profileJson);
    return profile.name || 'Unnamed Profile';
  } catch {
    return 'Unnamed Profile';
  }
}

/**
 * Extract profile metadata for display
 */
export interface ProfileMetadata {
  name: string;
  author?: string;
  beverageType?: string;
  stageCount: number;
  hasNotes: boolean;
}

export function extractProfileMetadata(profileJson: string): ProfileMetadata {
  try {
    const profile = parseProfile(profileJson);
    
    return {
      name: profile.name || 'Unnamed Profile',
      author: profile.author,
      beverageType: profile.beverage_type,
      stageCount: profile.steps?.length || 0,
      hasNotes: !!profile.notes,
    };
  } catch {
    return {
      name: 'Unnamed Profile',
      stageCount: 0,
      hasNotes: false,
    };
  }
}

/**
 * Validate profile completeness
 */
export function validateProfile(profile: ProfileData): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!profile.name || profile.name.trim() === '') {
    errors.push('Profile name is required');
  }

  if (!profile.steps || profile.steps.length === 0) {
    errors.push('Profile must have at least one step');
  }

  if (profile.steps) {
    profile.steps.forEach((step, index) => {
      if (!step.name) {
        errors.push(`Step ${index + 1} is missing a name`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format profile for export
 */
export function formatProfileForExport(profile: ProfileData): string {
  return JSON.stringify(profile, null, 2);
}

/**
 * Sanitize profile name for file system
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/**
 * Generate downloadable filename for profile
 */
export function generateProfileFileName(profileName: string): string {
  const sanitized = sanitizeFileName(profileName);
  const timestamp = new Date().toISOString().split('T')[0];
  return `${sanitized}_${timestamp}.json`;
}

/**
 * Compare two profiles for equality
 */
export function areProfilesEqual(
  profile1: ProfileData,
  profile2: ProfileData
): boolean {
  return JSON.stringify(profile1) === JSON.stringify(profile2);
}

/**
 * Merge profile data with updates
 */
export function mergeProfileData(
  original: ProfileData,
  updates: Partial<ProfileData>
): ProfileData {
  return {
    ...original,
    ...updates,
    steps: updates.steps || original.steps,
  };
}
