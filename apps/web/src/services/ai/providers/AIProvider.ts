export interface ProviderCapabilities {
  text: boolean
  vision: boolean
  imageGen: boolean
  jsonMode: boolean
  /**
   * Approximate total context window (input + output) in tokens, when the
   * provider has a hard limit small enough that full prompts overflow it.
   * On-device models (Apple Intelligence, Gemma) sit around 4096 tokens, so
   * the large analysis/profile prompts must be compacted for them. Hosted
   * providers leave this undefined (effectively unbounded for our prompts).
   */
  contextWindowTokens?: number
}

export interface AIProvider {
  id: string
  label: string
  capabilities: ProviderCapabilities
  isConfigured(): boolean
  detectFromKey(key: string): boolean
  /** Unified text generation with dynamic model resolution + single 404 retry. */
  generateText(req: { contents: unknown; config?: unknown }): Promise<{ text: string }>
  /** Optional — only when capabilities.imageGen. */
  generateImage?(prompt: string): Promise<Blob>
  /** Served, ranked model list for the picker. */
  listModels(): Promise<import('../modelResolver').AvailableModel[]>
}
