import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { 
  CaretLeft, 
  Play, 
  Clock, 
  Fire,
  Coffee,
  CalendarBlank,
  X,
  SpinnerGap,
  CheckCircle,
  Warning,
  Repeat,
  Plus,
  Trash,
  PencilSimple
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { format, addMinutes } from 'date-fns'

interface MachineProfile {
  id: string
  name: string
  author?: string
  temperature?: number
  final_weight?: number
}

interface ScheduledShot {
  id: string
  profile_id: string | null
  scheduled_time: string
  preheat: boolean
  status: string
  created_at: string
  error?: string
  recurring_schedule_id?: string
}

interface RecurringSchedule {
  id: string
  name: string
  time: string
  recurrence_type: 'daily' | 'weekdays' | 'weekends' | 'interval' | 'specific_days'
  interval_days?: number
  days_of_week?: number[]
  profile_id: string | null
  preheat: boolean
  enabled: boolean
  next_occurrence?: string
}

interface RunShotViewProps {
  onBack: () => void
  initialProfileId?: string
  initialProfileName?: string
}

const PREHEAT_DURATION_MINUTES = 10

export function RunShotView({ onBack, initialProfileId, initialProfileName }: RunShotViewProps) {
  const [selectedProfile, setSelectedProfile] = useState<MachineProfile | null>(
    initialProfileId && initialProfileName 
      ? { id: initialProfileId, name: initialProfileName } 
      : null
  )
  const [profiles, setProfiles] = useState<MachineProfile[]>([])
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true)
  const [showProfileSelector, setShowProfileSelector] = useState(false)
  
  const [preheat, setPreheat] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduledTime, setScheduledTime] = useState<Date>(addMinutes(new Date(), 30))
  
  const [isRunning, setIsRunning] = useState(false)
  const [isPreheating, setIsPreheating] = useState(false)
  
  const [scheduledShots, setScheduledShots] = useState<ScheduledShot[]>([])
  const [machineStatus, setMachineStatus] = useState<string>('unknown')
  
  // Recurring schedules state
  const [recurringSchedules, setRecurringSchedules] = useState<RecurringSchedule[]>([])
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [editingRecurring, setEditingRecurring] = useState<RecurringSchedule | null>(null)
  const [recurringName, setRecurringName] = useState('')
  const [recurringTime, setRecurringTime] = useState('07:00')
  const [recurringType, setRecurringType] = useState<'daily' | 'weekdays' | 'weekends' | 'interval' | 'specific_days'>('daily')
  const [recurringIntervalDays, setRecurringIntervalDays] = useState(1)
  const [recurringDaysOfWeek, setRecurringDaysOfWeek] = useState<number[]>([])
  const [recurringPreheat, setRecurringPreheat] = useState(true)
  const [recurringProfileId, setRecurringProfileId] = useState<string | null>(null)
  
  // Ref to track preheat timeout for cleanup
  const preheatTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup preheat timeout on unmount
  useEffect(() => {
    return () => {
      if (preheatTimeoutRef.current) {
        clearTimeout(preheatTimeoutRef.current)
      }
    }
  }, [])

  // Fetch profiles from machine
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/machine/profiles`)
        if (!response.ok) {
          console.error('Failed to fetch profiles: HTTP', response.status)
          toast.error('Failed to load profiles from machine')
          return
        }
        const data = await response.json()
        setProfiles(data.profiles || [])
      } catch (err) {
        console.error('Failed to fetch profiles:', err)
        toast.error('Failed to load profiles from machine')
      } finally {
        setIsLoadingProfiles(false)
      }
    }
    fetchProfiles()
  }, [])

  // Fetch machine status and scheduled shots
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/machine/status`)
        if (response.ok) {
          const data = await response.json()
          setMachineStatus(data.machine_status?.state || 'unknown')
          setScheduledShots(data.scheduled_shots || [])
        } else {
          let errorBody = ''
          try {
            errorBody = await response.text()
          } catch (readErr) {
            console.error('Failed to read error response body for machine status:', readErr)
          }
          console.error(
            `Non-OK response when fetching machine status: ${response.status} ${response.statusText}`,
            errorBody
          )
        }
      } catch (err) {
        console.error('Failed to fetch machine status:', err)
      }
    }
    fetchStatus()
    
    // Poll for updates
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  // Fetch recurring schedules
  useEffect(() => {
    const fetchRecurringSchedules = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/machine/recurring-schedules`)
        if (response.ok) {
          const data = await response.json()
          setRecurringSchedules(data.recurring_schedules || [])
        }
      } catch (err) {
        console.error('Failed to fetch recurring schedules:', err)
      }
    }
    fetchRecurringSchedules()
  }, [])

  const handleRunNow = async () => {
    if (!selectedProfile && !preheat) {
      toast.error('Please select a profile or enable preheat')
      return
    }

    setIsRunning(true)
    
    try {
      const serverUrl = await getServerUrl()
      
      if (preheat) {
        // Start preheat
        // Clear any existing preheat timeout
        if (preheatTimeoutRef.current) {
          clearTimeout(preheatTimeoutRef.current)
        }
        
        setIsPreheating(true)
        const preheatResponse = await fetch(`${serverUrl}/api/machine/preheat`, {
          method: 'POST'
        })
        
        if (!preheatResponse.ok) {
          let errorMessage = 'Failed to start preheat'
          try {
            const error = await preheatResponse.json()
            errorMessage = error?.detail || errorMessage
          } catch {
            // Ignore JSON parse errors and fall back to default message
          }
          setIsPreheating(false)
          throw new Error(errorMessage)
        }
        
        toast.success(`Preheating started! Ready in ${PREHEAT_DURATION_MINUTES} minutes`)
        
        // Set timeout to clear preheating state after duration
        preheatTimeoutRef.current = setTimeout(() => {
          setIsPreheating(false)
          preheatTimeoutRef.current = null
        }, PREHEAT_DURATION_MINUTES * 60 * 1000)
        
        if (selectedProfile) {
          // Schedule the profile to run after preheat
          const shotTime = addMinutes(new Date(), PREHEAT_DURATION_MINUTES)
          const scheduleResponse = await fetch(`${serverUrl}/api/machine/schedule-shot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              profile_id: selectedProfile.id,
              scheduled_time: shotTime.toISOString(),
              preheat: false // Already preheating
            })
          })

          if (!scheduleResponse.ok) {
            let errorMessage = 'Failed to schedule profile after preheat'
            try {
              const error = await scheduleResponse.json()
              errorMessage = error?.detail || errorMessage
            } catch {
              // Ignore JSON parse errors and fall back to default message
            }
            throw new Error(errorMessage)
          }

          toast.success(`Profile "${selectedProfile.name}" will run in ${PREHEAT_DURATION_MINUTES} minutes`)
        }
      } else if (selectedProfile) {
        // Run profile immediately
        const response = await fetch(`${serverUrl}/api/machine/run-profile/${selectedProfile.id}`, {
          method: 'POST'
        })
        
        if (!response.ok) {
          let errorMessage = 'Failed to run profile'
          try {
            const error = await response.json()
            errorMessage = error?.detail || errorMessage
          } catch {
            // Ignore JSON parse errors and fall back to default message
          }
          throw new Error(errorMessage)
        }
        
        toast.success(`Started "${selectedProfile.name}"!`)
      }
    } catch (err) {
      console.error('Failed to run shot:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to run shot')
      
      // Clear preheating state and timeout on error
      setIsPreheating(false)
      if (preheatTimeoutRef.current) {
        clearTimeout(preheatTimeoutRef.current)
        preheatTimeoutRef.current = null
      }
    } finally {
      setIsRunning(false)
    }
  }

  const handleSchedule = async () => {
    if (!selectedProfile && !preheat) {
      toast.error('Please select a profile or enable preheat')
      return
    }

    // Validate minimum scheduled time when preheat is enabled
    // Recalculate at validation time to ensure accuracy
    if (preheat) {
      const currentMinScheduledTime = addMinutes(new Date(), PREHEAT_DURATION_MINUTES)
      if (scheduledTime < currentMinScheduledTime) {
        toast.error(`Scheduled time must be at least ${PREHEAT_DURATION_MINUTES} minutes from now when preheat is enabled`)
        return
      }
    }

    setIsRunning(true)
    
    try {
      const serverUrl = await getServerUrl()
      
      const response = await fetch(`${serverUrl}/api/machine/schedule-shot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: selectedProfile?.id || null,
          scheduled_time: scheduledTime.toISOString(),
          preheat
        })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to schedule shot')
      }
      
      const data = await response.json()
      setScheduledShots(prev => [...prev, data.scheduled_shot])
      
      const preheatInfo = preheat ? ` (preheat starts ${PREHEAT_DURATION_MINUTES} min before)` : ''
      toast.success(`Shot scheduled for ${format(scheduledTime, 'HH:mm')}${preheatInfo}`)
      setScheduleMode(false)
    } catch (err) {
      console.error('Failed to schedule shot:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to schedule shot')
    } finally {
      setIsRunning(false)
    }
  }

  const handleCancelScheduled = async (scheduleId: string) => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/schedule-shot/${scheduleId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setScheduledShots(prev => prev.filter(s => s.id !== scheduleId))
        toast.success('Scheduled shot cancelled')
      }
    } catch (err) {
      console.error('Failed to cancel scheduled shot:', err)
      toast.error('Failed to cancel scheduled shot')
    }
  }

  // Recurring schedule handlers
  const resetRecurringForm = () => {
    setRecurringName('')
    setRecurringTime('07:00')
    setRecurringType('daily')
    setRecurringIntervalDays(1)
    setRecurringDaysOfWeek([])
    setRecurringPreheat(true)
    setRecurringProfileId(null)
    setEditingRecurring(null)
  }

  const handleSaveRecurring = async () => {
    try {
      const serverUrl = await getServerUrl()
      
      const body = {
        name: recurringName || `${recurringTime} ${recurringType}`,
        time: recurringTime,
        recurrence_type: recurringType,
        interval_days: recurringType === 'interval' ? recurringIntervalDays : undefined,
        days_of_week: recurringType === 'specific_days' ? recurringDaysOfWeek : undefined,
        profile_id: recurringProfileId,
        preheat: recurringPreheat,
        enabled: true
      }
      
      const url = editingRecurring 
        ? `${serverUrl}/api/machine/recurring-schedules/${editingRecurring.id}`
        : `${serverUrl}/api/machine/recurring-schedules`
      
      const response = await fetch(url, {
        method: editingRecurring ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to save schedule')
      }
      
      const data = await response.json()
      
      if (editingRecurring) {
        setRecurringSchedules(prev => prev.map(s => s.id === editingRecurring.id ? data.schedule : s))
        toast.success('Recurring schedule updated')
      } else {
        setRecurringSchedules(prev => [...prev, data.schedule])
        toast.success('Recurring schedule created')
      }
      
      resetRecurringForm()
      setShowRecurringForm(false)
    } catch (err) {
      console.error('Failed to save recurring schedule:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to save recurring schedule')
    }
  }

  const handleEditRecurring = (schedule: RecurringSchedule) => {
    setEditingRecurring(schedule)
    setRecurringName(schedule.name)
    setRecurringTime(schedule.time)
    setRecurringType(schedule.recurrence_type)
    setRecurringIntervalDays(schedule.interval_days || 1)
    setRecurringDaysOfWeek(schedule.days_of_week || [])
    setRecurringPreheat(schedule.preheat)
    setRecurringProfileId(schedule.profile_id)
    setShowRecurringForm(true)
  }

  const handleDeleteRecurring = async (scheduleId: string) => {
    if (!confirm('Are you sure you want to delete this recurring schedule?')) return
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/recurring-schedules/${scheduleId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setRecurringSchedules(prev => prev.filter(s => s.id !== scheduleId))
        toast.success('Recurring schedule deleted')
      }
    } catch (err) {
      console.error('Failed to delete recurring schedule:', err)
      toast.error('Failed to delete recurring schedule')
    }
  }

  const handleToggleRecurring = async (schedule: RecurringSchedule) => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/recurring-schedules/${schedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !schedule.enabled })
      })
      
      if (response.ok) {
        const data = await response.json()
        setRecurringSchedules(prev => prev.map(s => s.id === schedule.id ? data.schedule : s))
        toast.success(schedule.enabled ? 'Schedule paused' : 'Schedule enabled')
      }
    } catch (err) {
      console.error('Failed to toggle recurring schedule:', err)
      toast.error('Failed to update schedule')
    }
  }

  const getRecurrenceLabel = (schedule: RecurringSchedule) => {
    switch (schedule.recurrence_type) {
      case 'daily': return 'Every day'
      case 'weekdays': return 'Weekdays (Mon-Fri)'
      case 'weekends': return 'Weekends (Sat-Sun)'
      case 'interval': return `Every ${schedule.interval_days} day${(schedule.interval_days || 1) > 1 ? 's' : ''}`
      case 'specific_days': {
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        return (schedule.days_of_week || []).map(d => days[d]).join(', ')
      }
      default: return schedule.recurrence_type
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scheduled':
        return <Clock size={16} className="text-blue-500" />
      case 'preheating':
        return <Fire size={16} className="text-orange-500" />
      case 'running':
        return <SpinnerGap size={16} className="text-primary animate-spin" />
      case 'completed':
        return <CheckCircle size={16} className="text-green-500" />
      case 'failed':
      case 'cancelled':
        return <Warning size={16} className="text-red-500" />
      default:
        return null
    }
  }

  const getMachineStatusIndicatorClass = (status: string) => {
    switch (status) {
      case 'idle':
        return 'bg-green-500'
      case 'running':
        return 'bg-blue-500 animate-pulse'
      case 'error':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="shrink-0"
          title="Back"
        >
          <CaretLeft size={22} weight="bold" />
        </Button>
        <h2 className="text-xl font-bold">Run / Schedule</h2>
        {machineStatus !== 'unknown' && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1 rounded-full bg-muted/50 text-xs">
            <span className={`w-2 h-2 rounded-full ${getMachineStatusIndicatorClass(machineStatus)}`} />
            <span className="font-medium capitalize">{machineStatus}</span>
          </div>
        )}
      </div>

      {/* Preheating Indicator */}
      <AnimatePresence>
        {isPreheating && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4"
          >
            <div className="flex items-center gap-3">
              <Fire size={24} className="text-orange-500 animate-pulse" weight="duotone" />
              <div className="flex-1">
                <p className="font-medium text-orange-700 dark:text-orange-400">Preheating in Progress</p>
                <p className="text-sm text-orange-600/80 dark:text-orange-400/80">
                  Machine is heating up. Ready in approximately {PREHEAT_DURATION_MINUTES} minutes.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop two-column layout */}
      <div className="desktop-two-col">
      {/* Left column: Profile + Options + Action */}
      <div className="space-y-6 desktop-panel-left">

      {/* Profile Selection */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Profile</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowProfileSelector(!showProfileSelector)}
          >
            {selectedProfile ? 'Change' : 'Select Profile'}
          </Button>
        </div>
        
        {selectedProfile ? (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <Coffee size={24} className="text-primary" weight="duotone" />
            <div>
              <p className="font-medium">{selectedProfile.name}</p>
              {selectedProfile.temperature != null && selectedProfile.final_weight != null && (
                <p className="text-sm text-muted-foreground">
                  {selectedProfile.temperature}°C • {selectedProfile.final_weight}g
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No profile selected. Select a profile or use preheat only.
          </p>
        )}

        {/* Profile Selector */}
        <AnimatePresence>
          {showProfileSelector && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="max-h-48 overflow-y-auto space-y-1 pt-2 border-t">
                {isLoadingProfiles ? (
                  <div className="flex items-center justify-center py-4">
                    <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
                  </div>
                ) : profiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No profiles found on machine
                  </p>
                ) : (
                  profiles.map(profile => (
                    <button
                      key={profile.id}
                      onClick={() => {
                        setSelectedProfile(profile)
                        setShowProfileSelector(false)
                      }}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedProfile?.id === profile.id
                          ? 'bg-primary/10 border border-primary/30'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <p className="font-medium">{profile.name}</p>
                      {profile.author && (
                        <p className="text-xs text-muted-foreground">by {profile.author}</p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Options */}
      <Card className="p-6 space-y-4">
        <h3 className="text-base font-medium">Options</h3>
        
        {/* Preheat Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="preheat" className="text-sm font-medium flex items-center gap-2">
              <Fire size={18} className={preheat ? 'text-orange-500' : 'text-muted-foreground'} />
              Preheat
            </Label>
            <p className="text-xs text-muted-foreground">
              Preheat machine for {PREHEAT_DURATION_MINUTES} minutes
            </p>
          </div>
          <Switch
            id="preheat"
            checked={preheat}
            onCheckedChange={setPreheat}
          />
        </div>

        {/* Schedule Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="schedule" className="text-sm font-medium flex items-center gap-2">
              <CalendarBlank size={18} className={scheduleMode ? 'text-primary' : 'text-muted-foreground'} />
              Schedule
            </Label>
            <p className="text-xs text-muted-foreground">
              Run later at a specific time
            </p>
          </div>
          <Switch
            id="schedule"
            checked={scheduleMode}
            onCheckedChange={setScheduleMode}
          />
        </div>

        {/* Time Picker (when scheduling) */}
        <AnimatePresence>
          {scheduleMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-3 border-t space-y-2">
                <Label className="text-sm">Scheduled Time</Label>
                <input
                  type="datetime-local"
                  value={format(scheduledTime, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => {
                    const next = new Date(e.target.value)
                    if (!isNaN(next.getTime())) {
                      setScheduledTime(next)
                    }
                  }}
                  min={format(
                    preheat ? addMinutes(new Date(), PREHEAT_DURATION_MINUTES) : new Date(),
                    "yyyy-MM-dd'T'HH:mm"
                  )}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
                {preheat && (
                  <p className="text-xs text-muted-foreground">
                    Preheat will start at {format(addMinutes(scheduledTime, -PREHEAT_DURATION_MINUTES), 'HH:mm')}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Action Button */}
      <Button
        size="lg"
        className="w-full"
        onClick={scheduleMode ? handleSchedule : handleRunNow}
        disabled={isRunning || (!selectedProfile && !preheat)}
      >
        {isRunning ? (
          <SpinnerGap size={20} className="animate-spin mr-2" />
        ) : scheduleMode ? (
          <Clock size={20} className="mr-2" />
        ) : (
          <Play size={20} className="mr-2" weight="fill" />
        )}
        {isRunning 
          ? 'Starting...' 
          : scheduleMode 
            ? 'Schedule Shot'
            : preheat && selectedProfile 
              ? 'Preheat & Run' 
              : preheat 
                ? 'Start Preheat' 
                : 'Run Now'}
      </Button>

      {/* Help Text */}
      <p className="text-xs text-muted-foreground text-center">
        {!selectedProfile && preheat && 'Preheat only - no profile will be run'}
        {selectedProfile && !preheat && !scheduleMode && 'Profile will start immediately'}
        {selectedProfile && preheat && !scheduleMode && `Preheat will start now, profile runs in ${PREHEAT_DURATION_MINUTES} min`}
        {scheduleMode && preheat && `Preheat starts ${PREHEAT_DURATION_MINUTES} min before scheduled time`}
      </p>
      </div>{/* end left column */}

      {/* Right column: Schedules */}
      <div className="space-y-6 desktop-panel-right">

      {/* Scheduled Shots */}
      {scheduledShots.filter(s => s.status !== 'completed' && s.status !== 'cancelled').length > 0 && (
        <Card className="p-6 space-y-4">
          <h3 className="text-base font-medium">Scheduled Shots</h3>
          <div className="space-y-2">
            {scheduledShots
              .filter(s => s.status !== 'completed' && s.status !== 'cancelled')
              .map(shot => (
                <div key={shot.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(shot.status)}
                    <div>
                      <p className="text-sm font-medium">
                        {format(new Date(shot.scheduled_time), 'HH:mm')}
                        {shot.preheat && <span className="text-orange-500 ml-1">(with preheat)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{shot.status}</p>
                    </div>
                  </div>
                  {shot.status === 'scheduled' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCancelScheduled(shot.id)}
                      aria-label="Cancel scheduled shot"
                      title="Cancel scheduled shot"
                    >
                      <X size={16} />
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Recurring Schedules */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Repeat size={20} className="text-primary" />
            <h3 className="text-base font-medium">Recurring Schedules</h3>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetRecurringForm()
              setShowRecurringForm(true)
            }}
          >
            <Plus size={16} className="mr-1" />
            Add
          </Button>
        </div>

        {/* Recurring Schedule Form */}
        <AnimatePresence>
          {showRecurringForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 pt-2 border-t"
            >
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Schedule Name (optional)</Label>
                  <input
                    type="text"
                    value={recurringName}
                    onChange={e => setRecurringName(e.target.value)}
                    placeholder="e.g., Morning coffee"
                    className="w-full mt-1 px-3 py-2 bg-background border rounded-md text-sm"
                  />
                </div>

                <div>
                  <Label className="text-sm">Time</Label>
                  <input
                    type="time"
                    value={recurringTime}
                    onChange={e => setRecurringTime(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-background border rounded-md text-sm"
                  />
                </div>

                <div>
                  <Label className="text-sm">Repeat</Label>
                  <select
                    value={recurringType}
                    onChange={e => setRecurringType(e.target.value as typeof recurringType)}
                    className="w-full mt-1 px-3 py-2 bg-background border rounded-md text-sm"
                  >
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays (Mon-Fri)</option>
                    <option value="weekends">Weekends (Sat-Sun)</option>
                    <option value="interval">Every X days</option>
                    <option value="specific_days">Specific days</option>
                  </select>
                </div>

                {recurringType === 'interval' && (
                  <div>
                    <Label className="text-sm">Every X days</Label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={recurringIntervalDays}
                      onChange={e => setRecurringIntervalDays(parseInt(e.target.value) || 1)}
                      className="w-full mt-1 px-3 py-2 bg-background border rounded-md text-sm"
                    />
                  </div>
                )}

                {recurringType === 'specific_days' && (
                  <div>
                    <Label className="text-sm">Select days</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
                        <Button
                          key={day}
                          type="button"
                          variant={recurringDaysOfWeek.includes(idx) ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => {
                            if (recurringDaysOfWeek.includes(idx)) {
                              setRecurringDaysOfWeek(prev => prev.filter(d => d !== idx))
                            } else {
                              setRecurringDaysOfWeek(prev => [...prev, idx].sort())
                            }
                          }}
                        >
                          {day}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-sm">Profile (optional)</Label>
                  <select
                    value={recurringProfileId || ''}
                    onChange={e => setRecurringProfileId(e.target.value || null)}
                    className="w-full mt-1 px-3 py-2 bg-background border rounded-md text-sm"
                  >
                    <option value="">Preheat only</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-sm">Preheat before shot</Label>
                  <Switch checked={recurringPreheat} onCheckedChange={setRecurringPreheat} />
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  className="flex-1" 
                  onClick={handleSaveRecurring}
                  disabled={recurringType === 'specific_days' && recurringDaysOfWeek.length === 0}
                >
                  {editingRecurring ? 'Update' : 'Create'} Schedule
                </Button>
                <Button variant="outline" onClick={() => {
                  resetRecurringForm()
                  setShowRecurringForm(false)
                }}>
                  Cancel
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* List of recurring schedules */}
        {recurringSchedules.length > 0 && !showRecurringForm && (
          <div className="space-y-2">
            {recurringSchedules.map(schedule => (
              <div 
                key={schedule.id} 
                className={`flex items-center justify-between p-3 rounded-lg ${schedule.enabled ? 'bg-muted/50' : 'bg-muted/20 opacity-60'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <span className="text-lg font-bold">{schedule.time}</span>
                    <Repeat size={14} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{schedule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {getRecurrenceLabel(schedule)}
                      {schedule.preheat && <span className="text-orange-500 ml-1">• Preheat</span>}
                    </p>
                    {schedule.next_occurrence && schedule.enabled && (
                      <p className="text-xs text-primary">
                        Next: {format(new Date(schedule.next_occurrence), 'EEE, MMM d HH:mm')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleToggleRecurring(schedule)}
                    title={schedule.enabled ? 'Pause schedule' : 'Enable schedule'}
                  >
                    {schedule.enabled ? <Clock size={16} /> : <Play size={16} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEditRecurring(schedule)}
                    title="Edit schedule"
                  >
                    <PencilSimple size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteRecurring(schedule.id)}
                    title="Delete schedule"
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {recurringSchedules.length === 0 && !showRecurringForm && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No recurring schedules yet. Create one to automatically preheat or run shots at set times.
          </p>
        )}
      </Card>
      </div>{/* end right column */}
      </div>{/* end two-column wrapper */}
    </motion.div>
  )
}
