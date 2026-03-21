/// <reference types="vite/client" />
declare const GITHUB_RUNTIME_PERMANENT_NAME: string
declare const BASE_KV_SERVICE_URL: string
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_MACHINE_MODE?: 'direct' | 'proxy'
  readonly VITE_DEFAULT_MACHINE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}