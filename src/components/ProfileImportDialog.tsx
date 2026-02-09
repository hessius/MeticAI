import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  X,
  Upload,
  CloudArrowDown,
  Coffee,
  SpinnerGap,
  CheckCircle,
  Warning,
  CaretRight,
  Plus,
  MagicWand,
  DownloadSimple,
  Info
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'

interface MachineProfile {
  id: string
  name: string
  author?: string
  temperature?: number
  final_weight?: number
  in_history: boolean
  has_description: boolean
}

interface BulkImportProgress {
  type: 'start' | 'progress' | 'imported' | 'failed' | 'complete' | 'error'
  current?: number
  total?: number
  to_import?: number
  already_imported?: number
  profile_name?: string
  message: string
  imported?: number
  skipped?: number
  failed?: number
  error?: string
}

interface ProfileImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImported: () => void
  onGenerateNew: () => void
}

type ImportStep = 'choose' | 'file' | 'machine' | 'importing' | 'bulk-importing' | 'success' | 'bulk-success' | 'error'

export function ProfileImportDialog({ isOpen, onClose, onImported, onGenerateNew }: ProfileImportDialogProps) {
  const [step, setStep] = useState<ImportStep>('choose')
  const [machineProfiles, setMachineProfiles] = useState<MachineProfile[]>([])
  const [loadingMachine, setLoadingMachine] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<MachineProfile | null>(null)
  const [importProgress, setImportProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importedProfileName, setImportedProfileName] = useState<string | null>(null)
  const [bulkProgress, setBulkProgress] = useState<BulkImportProgress | null>(null)
  const [bulkLogs, setBulkLogs] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('choose')
      setMachineProfiles([])
      setSelectedProfile(null)
      setError(null)
      setImportedProfileName(null)
      setBulkProgress(null)
      setBulkLogs([])
    } else {
      // Cleanup abort controller when dialog closes
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [isOpen])

  const fetchMachineProfiles = async () => {
    setLoadingMachine(true)
    setError(null)
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/profiles`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch profiles from machine')
      }
      
      const data = await response.json()
      
      // Filter out profiles already in history
      const availableProfiles = data.profiles.filter((p: MachineProfile) => !p.in_history)
      setMachineProfiles(availableProfiles)
      setStep('machine')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to machine')
    } finally {
      setLoadingMachine(false)
    }
  }

  const handleBulkImport = async () => {
    setStep('bulk-importing')
    setBulkProgress(null)
    setBulkLogs([])
    setError(null)
    
    try {
      const serverUrl = await getServerUrl()
      abortControllerRef.current = new AbortController()
      
      const response = await fetch(`${serverUrl}/api/profile/import-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal
      })
      
      if (!response.ok) {
        throw new Error('Failed to start bulk import')
      }
      
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      
      if (!reader) {
        throw new Error('No response stream available')
      }
      
      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const progress = JSON.parse(line) as BulkImportProgress
              setBulkProgress(progress)
              
              if (progress.type === 'imported' || progress.type === 'failed' || progress.type === 'progress') {
                setBulkLogs(prev => [...prev.slice(-4), progress.message])
              }
              
              if (progress.type === 'complete') {
                setStep('bulk-success')
              } else if (progress.type === 'error') {
                setError(progress.message)
                setStep('error')
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Import was cancelled
        return
      }
      setError(err instanceof Error ? err.message : 'Bulk import failed')
      setStep('error')
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    setStep('importing')
    setImportProgress('Reading file...')
    setError(null)
    
    try {
      const text = await file.text()
      const profileJson = JSON.parse(text)
      
      setImportProgress('Importing profile...')
      
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/profile/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: profileJson,
          generate_description: true,
          source: 'file'
        })
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = typeof errorData.detail === 'string' 
          ? errorData.detail 
          : errorData.detail?.error || errorData.detail?.message || 'Import failed'
        throw new Error(errorMessage)
      }
      
      const result = await response.json()
      
      if (result.status === 'exists') {
        setError(`Profile "${result.profile_name || profileJson.name}" already exists in your catalogue`)
        setStep('error')
        return
      }
      
      setImportedProfileName(result.profile_name)
      setStep('success')
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON file. Please select a valid profile JSON.')
      } else {
        setError(err instanceof Error ? err.message : 'Import failed')
      }
      setStep('error')
    }
  }

  const handleMachineImport = async (profile: MachineProfile) => {
    setSelectedProfile(profile)
    setStep('importing')
    setImportProgress('Fetching profile from machine...')
    setError(null)
    
    try {
      const serverUrl = await getServerUrl()
      
      // First get the full profile JSON
      const profileResponse = await fetch(`${serverUrl}/api/machine/profile/${profile.id}/json`)
      
      if (!profileResponse.ok) {
        throw new Error('Failed to fetch profile details')
      }
      
      const profileData = await profileResponse.json()
      
      setImportProgress('Importing and generating description...')
      
      // Now import it
      const importResponse = await fetch(`${serverUrl}/api/profile/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: profileData.profile,
          generate_description: true,
          source: 'machine'
        })
      })
      
      if (!importResponse.ok) {
        const errorData = await importResponse.json()
        const errorMessage = typeof errorData.detail === 'string' 
          ? errorData.detail 
          : errorData.detail?.error || errorData.detail?.message || 'Import failed'
        throw new Error(errorMessage)
      }
      
      const result = await importResponse.json()
      setImportedProfileName(result.profile_name)
      setStep('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('error')
    }
  }

  const handleClose = () => {
    if (step === 'success' || step === 'bulk-success') {
      onImported()
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="p-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <Plus size={20} className="text-amber-500" weight="bold" />
              </div>
              <h2 className="text-lg font-bold tracking-tight">Add Profile</h2>
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
              <X size={18} weight="bold" />
            </Button>
          </div>

          <AnimatePresence mode="wait">
            {/* Step: Choose Action */}
            {step === 'choose' && (
              <motion.div
                key="choose"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-3"
              >
                <Button
                  onClick={onGenerateNew}
                  className="w-full h-14 text-base font-semibold bg-amber-500 hover:bg-amber-600 text-zinc-900"
                >
                  <MagicWand size={20} className="mr-2" weight="fill" />
                  Generate New Profile
                </Button>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border/30" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-card px-3 text-xs text-muted-foreground font-medium">or import</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-24 flex-col gap-2 border-border/50 hover:border-primary/50 hover:bg-primary/5"
                  >
                    <Upload size={28} weight="duotone" className="text-primary" />
                    <span className="text-sm font-medium">From File</span>
                    <span className="text-[10px] text-muted-foreground">JSON profile</span>
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={fetchMachineProfiles}
                    disabled={loadingMachine}
                    className="h-24 flex-col gap-2 border-border/50 hover:border-primary/50 hover:bg-primary/5"
                  >
                    {loadingMachine ? (
                      <SpinnerGap size={28} className="animate-spin text-primary" />
                    ) : (
                      <CloudArrowDown size={28} weight="duotone" className="text-primary" />
                    )}
                    <span className="text-sm font-medium">From Machine</span>
                    <span className="text-[10px] text-muted-foreground">Meticulous</span>
                  </Button>
                </div>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </motion.div>
            )}

            {/* Step: Machine Profiles */}
            {step === 'machine' && (
              <motion.div
                key="machine"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    Profiles on Machine
                  </Label>
                  <Badge variant="secondary" className="text-xs">
                    {machineProfiles.length} available
                  </Badge>
                </div>
                
                {machineProfiles.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <Coffee size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">All machine profiles are already in your catalogue</p>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {machineProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        onClick={() => handleMachineImport(profile)}
                        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/40 hover:bg-primary/10 border border-border/30 hover:border-primary/30 transition-colors text-left group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{profile.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {profile.author && (
                              <span className="text-xs text-muted-foreground">{profile.author}</span>
                            )}
                            {profile.temperature && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {profile.temperature}°C
                              </Badge>
                            )}
                            {profile.final_weight && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {profile.final_weight}g
                              </Badge>
                            )}
                          </div>
                        </div>
                        <CaretRight size={18} className="text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Import All Section */}
                {machineProfiles.length > 0 && (
                  <div className="pt-2 border-t border-border/30">
                    <Alert className="mb-3 bg-blue-500/5 border-blue-500/20">
                      <Info size={16} className="text-blue-500" />
                      <AlertDescription className="text-xs text-blue-200/80">
                        Importing generates AI descriptions for each profile and will consume API tokens.
                      </AlertDescription>
                    </Alert>
                    <Button
                      onClick={handleBulkImport}
                      className="w-full bg-primary/90 hover:bg-primary text-primary-foreground"
                    >
                      <DownloadSimple size={18} className="mr-2" weight="bold" />
                      Import All {machineProfiles.length} Profiles
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {/* Step: Bulk Importing */}
            {step === 'bulk-importing' && (
              <motion.div
                key="bulk-importing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="py-6 space-y-4"
              >
                <div className="text-center">
                  <SpinnerGap size={40} className="mx-auto animate-spin text-primary mb-3" />
                  <p className="font-semibold">
                    {bulkProgress?.type === 'start' 
                      ? 'Starting import...'
                      : bulkProgress?.current && bulkProgress?.total
                        ? `Importing ${bulkProgress.current}/${bulkProgress.total}`
                        : 'Preparing...'
                    }
                  </p>
                  {bulkProgress?.profile_name && (
                    <p className="text-sm text-muted-foreground mt-1 truncate px-4">
                      {bulkProgress.profile_name}
                    </p>
                  )}
                </div>
                
                {/* Progress bar */}
                {bulkProgress?.current && bulkProgress?.total && (
                  <div className="space-y-1.5">
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      {Math.round((bulkProgress.current / bulkProgress.total) * 100)}% complete
                    </p>
                  </div>
                )}
                
                {/* Activity log */}
                {bulkLogs.length > 0 && (
                  <div className="bg-secondary/40 rounded-lg p-3 max-h-24 overflow-y-auto">
                    <div className="space-y-1">
                      {bulkLogs.map((log, idx) => (
                        <p key={idx} className="text-xs text-muted-foreground truncate">
                          {log}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                
                <p className="text-xs text-center text-muted-foreground/70">
                  Generating AI descriptions for each profile...
                </p>
              </motion.div>
            )}

            {/* Step: Importing */}
            {step === 'importing' && (
              <motion.div
                key="importing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="py-8 text-center space-y-4"
              >
                <SpinnerGap size={48} className="mx-auto animate-spin text-primary" />
                <div>
                  <p className="font-medium">{importProgress}</p>
                  {selectedProfile && (
                    <p className="text-sm text-muted-foreground mt-1">{selectedProfile.name}</p>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step: Success */}
            {step === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="py-6 text-center space-y-4"
              >
                <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle size={40} weight="fill" className="text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-lg">Profile Imported!</p>
                  {importedProfileName && (
                    <p className="text-sm text-muted-foreground mt-1">{importedProfileName}</p>
                  )}
                </div>
                <Button onClick={handleClose} className="w-full">
                  View in Catalogue
                </Button>
              </motion.div>
            )}

            {/* Step: Bulk Success */}
            {step === 'bulk-success' && (
              <motion.div
                key="bulk-success"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="py-6 text-center space-y-4"
              >
                <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle size={40} weight="fill" className="text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-lg">Import Complete!</p>
                  <div className="flex items-center justify-center gap-4 mt-2 text-sm">
                    {bulkProgress?.imported !== undefined && bulkProgress.imported > 0 && (
                      <span className="text-green-500">
                        {bulkProgress.imported} imported
                      </span>
                    )}
                    {bulkProgress?.skipped !== undefined && bulkProgress.skipped > 0 && (
                      <span className="text-muted-foreground">
                        {bulkProgress.skipped} skipped
                      </span>
                    )}
                    {bulkProgress?.failed !== undefined && bulkProgress.failed > 0 && (
                      <span className="text-destructive">
                        {bulkProgress.failed} failed
                      </span>
                    )}
                  </div>
                </div>
                <Button onClick={handleClose} className="w-full">
                  View in Catalogue
                </Button>
              </motion.div>
            )}

            {/* Step: Error */}
            {step === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <Alert variant="destructive" className="border-destructive/30 bg-destructive/8">
                  <Warning size={18} weight="fill" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
                <Button variant="outline" onClick={() => setStep('choose')} className="w-full">
                  Try Again
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </motion.div>
    </motion.div>
  )
}
