/**
 * useStorageMigration — runs on first mount to initialize IndexedDB
 * and clean up stale caches. Only runs in direct (PWA) mode.
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
