/**
 * useStorageMigration — runs on first mount to initialize IndexedDB
 * and clean up stale caches. Runs in direct mode (machine-hosted PWA and Capacitor/native).
 */

import { useEffect, useRef } from 'react'
import { isDirectMode } from '@/lib/machineMode'
import { initializeStorage } from './AppDatabase'

export function useStorageMigration(): void {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current || !isDirectMode()) return
    initialized.current = true
    initializeStorage().catch(err => {
      console.warn('IndexedDB initialization failed:', err)
    })
  }, [])
}
