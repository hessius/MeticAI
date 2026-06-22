export interface ProviderCapabilities {
  text: boolean
  vision: boolean
  imageGen: boolean
  jsonMode: boolean
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
