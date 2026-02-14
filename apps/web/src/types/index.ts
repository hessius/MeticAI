import { z } from 'zod';

// ============================================================================
// API Response Types
// ============================================================================

export const APIResponseSchema = z.object({
  status: z.enum(['success', 'error', 'pending']),
  analysis: z.string(),
  reply: z.string(),
  history_id: z.string().optional(),
});

export type APIResponse = z.infer<typeof APIResponseSchema>;

// ============================================================================
// Profile Types
// ============================================================================

export const ProfileStageSchema = z.object({
  name: z.string(),
  temperature: z.number().optional(),
  volume: z.number().optional(),
  pressure: z.number().optional(),
  flow: z.number().optional(),
  transition: z.string().optional(),
  exit: z.object({
    type: z.string(),
    condition: z.union([z.string(), z.number()]),
  }).optional(),
});

export const ProfileDataSchema = z.object({
  name: z.string(),
  author: z.string().optional(),
  notes: z.string().optional(),
  beverage_type: z.string().optional(),
  steps: z.array(ProfileStageSchema).optional(),
  // Allow additional properties for flexibility
}).passthrough();

export type ProfileData = z.infer<typeof ProfileDataSchema>;
export type ProfileStage = z.infer<typeof ProfileStageSchema>;

// ============================================================================
// History Types
// ============================================================================

export const HistoryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  profile_json: z.string(), // JSON string that can be parsed to ProfileData
  image_url: z.string().nullable(),
  preferences: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistoryResponseSchema = z.object({
  profiles: z.array(HistoryEntrySchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  has_more: z.boolean(),
});

export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

// ============================================================================
// Shot History Types
// ============================================================================

export const ShotDataSchema = z.object({
  id: z.string(),
  profile_id: z.string(),
  profile_name: z.string(),
  timestamp: z.string(),
  duration: z.number().optional(),
  weight: z.number().optional(),
  rating: z.number().optional(),
  notes: z.string().optional(),
  temperature: z.number().optional(),
  pressure: z.number().optional(),
  // Additional metadata
}).passthrough();

export type ShotData = z.infer<typeof ShotDataSchema>;

// ============================================================================
// Advanced Customization Types
// ============================================================================

export const AdvancedCustomizationOptionsSchema = z.object({
  basketSize: z.enum(['single', 'double', 'triple']).optional(),
  waterTemp: z.number().min(80).max(100).optional(),
  maxPressure: z.number().min(1).max(12).optional(),
  maxFlow: z.number().min(0.1).max(10).optional(),
  preInfusionTime: z.number().min(0).max(30).optional(),
  targetVolume: z.number().min(10).max(100).optional(),
  grindSize: z.string().optional(),
  doseWeight: z.number().min(5).max(30).optional(),
});

export type AdvancedCustomizationOptions = z.infer<typeof AdvancedCustomizationOptionsSchema>;

// ============================================================================
// View State Types
// ============================================================================

export type ViewState = 
  | 'start' 
  | 'form' 
  | 'loading' 
  | 'results' 
  | 'error' 
  | 'history' 
  | 'history-detail' 
  | 'settings' 
  | 'run-shot'
  | 'live-shot';

// ============================================================================
// Tag Types
// ============================================================================

export type TagCategory = 
  | 'body' 
  | 'flavor' 
  | 'mouthfeel' 
  | 'style' 
  | 'extraction' 
  | 'roast' 
  | 'characteristic' 
  | 'process';

export interface PresetTag {
  id: string;
  label: string;
  category: TagCategory;
  description?: string;
}

// ============================================================================
// Update Types
// ============================================================================

export const UpdateStatusSchema = z.object({
  available: z.boolean(),
  version: z.string().optional(),
  releaseDate: z.string().optional(),
  notes: z.string().optional(),
});

export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

// ============================================================================
// Config Types
// ============================================================================

export const ServerConfigSchema = z.object({
  serverUrl: z.string().url(),
  apiVersion: z.string().optional(),
  timeout: z.number().optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ============================================================================
// Form Types
// ============================================================================

export interface ProfileFormData {
  image: File | null;
  preferences: string;
  tags: string[];
  advancedOptions: AdvancedCustomizationOptions;
}

// ============================================================================
// Error Types
// ============================================================================

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class ValidationError extends Error {
  public zodErrors?: z.ZodError;
  public cause?: unknown;
  constructor(
    message: string,
    causeOrZodError?: z.ZodError | unknown
  ) {
    super(message);
    this.name = 'ValidationError';
    if (causeOrZodError instanceof z.ZodError) {
      this.zodErrors = causeOrZodError;
    } else {
      this.cause = causeOrZodError;
    }
  }
}

// ============================================================================
// Utility Types
// ============================================================================

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;

// Generic async state
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
