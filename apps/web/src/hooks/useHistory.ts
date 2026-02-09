import { useState, useCallback } from 'react'
import { getServerUrl } from '@/lib/config'

export interface HistoryEntry {
  id: string
  created_at: string
  profile_name: string
  coffee_analysis: string | null
  user_preferences: string | null
  reply: string
  profile_json: Record<string, unknown> | null
}

export interface HistoryResponse {
  entries: HistoryEntry[]
  total: number
  limit: number
  offset: number
}

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = useCallback(async (limit = 50, offset = 0) => {
    setIsLoading(true)
    setError(null)

    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/history?limit=${limit}&offset=${offset}`)
      
      if (!response.ok) {
        throw new Error(`Failed to fetch history: ${response.status}`)
      }

      const data: HistoryResponse = await response.json()
      setEntries(data.entries)
      setTotal(data.total)
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch history'
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchEntry = useCallback(async (entryId: string): Promise<HistoryEntry> => {
    const serverUrl = await getServerUrl()
    const response = await fetch(`${serverUrl}/api/history/${entryId}`)
    
    if (!response.ok) {
      throw new Error(`Failed to fetch entry: ${response.status}`)
    }

    return response.json()
  }, [])

  const deleteEntry = useCallback(async (entryId: string) => {
    const serverUrl = await getServerUrl()
    const response = await fetch(`${serverUrl}/api/history/${entryId}`, {
      method: 'DELETE'
    })
    
    if (!response.ok) {
      throw new Error(`Failed to delete entry: ${response.status}`)
    }

    // Update local state
    setEntries(prev => prev.filter(e => e.id !== entryId))
    setTotal(prev => prev - 1)
    
    return response.json()
  }, [])

  const clearHistory = useCallback(async () => {
    const serverUrl = await getServerUrl()
    const response = await fetch(`${serverUrl}/api/history`, {
      method: 'DELETE'
    })
    
    if (!response.ok) {
      throw new Error(`Failed to clear history: ${response.status}`)
    }

    setEntries([])
    setTotal(0)
    
    return response.json()
  }, [])

  const downloadJson = useCallback(async (entry: HistoryEntry) => {
    if (!entry.profile_json) {
      throw new Error('No profile JSON available for this entry')
    }

    // Create filename from profile name
    const safeName = entry.profile_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const blob = new Blob([JSON.stringify(entry.profile_json, null, 2)], {
      type: 'application/json'
    })
    
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeName || 'profile'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  return {
    entries,
    total,
    isLoading,
    error,
    fetchHistory,
    fetchEntry,
    deleteEntry,
    clearHistory,
    downloadJson
  }
}
