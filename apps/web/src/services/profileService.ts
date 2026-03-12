import { getServerUrl } from '@/lib/config';
import { apiFetch, createFormData } from './api';
import { APIResponse, APIResponseSchema, AdvancedCustomizationOptions } from '@/types';

export interface AnalyzeImageRequest {
  image: File;
  preferences?: string;
  tags?: string[];
  advancedOptions?: AdvancedCustomizationOptions;
}

export interface ProfileCountResponse {
  count: number;
}

/**
 * Profile Service - handles all profile-related API calls
 */
export class ProfileService {
  private baseUrl: string | undefined;
  private baseUrlPromise: Promise<string> | undefined;

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else {
      this.baseUrlPromise = getServerUrl();
    }
  }

  private async getBaseUrl(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    if (!this.baseUrlPromise) {
      this.baseUrlPromise = getServerUrl();
    }
    this.baseUrl = await this.baseUrlPromise;
    return this.baseUrl;
  }

  /**
   * Get the total count of profiles
   */
  async getProfileCount(): Promise<number> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await apiFetch<ProfileCountResponse>(
        `${baseUrl}/api/profile-count`
      );
      return response.count;
    } catch (error) {
      console.debug('Failed to fetch profile count', { error });
      return 0;
    }
  }

  /**
   * Analyze an image and generate a profile
   */
  async analyzeImage(request: AnalyzeImageRequest): Promise<APIResponse> {
    const baseUrl = await this.getBaseUrl();
    const formData = createFormData({
      image: request.image,
      preferences: request.preferences || '',
      tags: JSON.stringify(request.tags || []),
      advanced_options: JSON.stringify(request.advancedOptions || {}),
    });

    const response = await apiFetch<unknown>(
      `${baseUrl}/api/analyze`,
      {
        method: 'POST',
        body: formData,
      }
    );

    // Validate response with Zod
    return APIResponseSchema.parse(response);
  }

  /**
   * Delete a profile by ID
   */
  async deleteProfile(profileId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await apiFetch(
      `${baseUrl}/api/profiles/${profileId}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Edit a profile on the machine (name, temperature, final_weight, variables, author)
   */
  async updateProfile(
    profileName: string,
    data: {
      name?: string;
      temperature?: number;
      final_weight?: number;
      variables?: { key: string; value: number | string }[];
      author?: string;
    }
  ): Promise<{ status: string; profile: { id: string; name: string; temperature?: number; final_weight?: number; author?: string } }> {
    const baseUrl = await this.getBaseUrl();
    return await apiFetch(
      `${baseUrl}/api/profile/${encodeURIComponent(profileName)}/edit`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );
  }

  /**
   * Export profile as JSON file
   */
  async exportProfile(profileId: string): Promise<Blob> {
    const baseUrl = await this.getBaseUrl();
    return await apiFetch<Blob>(
      `${baseUrl}/api/profiles/${profileId}/export`,
      { responseType: 'blob' }
    );
  }
}

// Export singleton instance
export const profileService = new ProfileService();
