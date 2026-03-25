import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'

interface CoffeeDetails {
  roast_level: string
  origin?: string
  process?: string
  roast_date?: string
}

interface DialInProfileStepProps {
  coffee: CoffeeDetails
  onSelect: (profileName: string) => void
  aiConfigured?: boolean
}

interface ProfileSummary {
  name: string
  author?: string
}

export function DialInProfileStep({ coffee, onSelect }: DialInProfileStepProps) {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [manualName, setManualName] = useState('')

  useEffect(() => {
    let cancelled = false
    const fetchProfiles = async () => {
      try {
        const serverUrl = await getServerUrl()
        const resp = await fetch(`${serverUrl}/api/profiles`)
        if (resp.ok) {
          const data = await resp.json()
          // data is array of profile objects with .name
          const list: ProfileSummary[] = (data || []).map((p: { name: string; author?: string }) => ({
            name: p.name,
            author: p.author,
          }))
          if (!cancelled) setProfiles(list)
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchProfiles()
    return () => { cancelled = true }
  }, [coffee])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('dialIn.profile.description')}</p>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-4">{t('common.loading')}</p>
      ) : profiles.length > 0 ? (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {profiles.slice(0, 10).map((p) => (
            <Button
              key={p.name}
              variant="outline"
              className="w-full justify-start text-left h-auto py-2"
              onClick={() => onSelect(p.name)}
            >
              <div>
                <div className="font-medium text-sm">{p.name}</div>
                {p.author && <div className="text-xs text-muted-foreground">{p.author}</div>}
              </div>
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">{t('dialIn.profile.noProfiles')}</p>
      )}

      <div className="border-t pt-3 space-y-2">
        <Label>{t('dialIn.profile.manual')}</Label>
        <div className="flex gap-2">
          <Input
            placeholder={t('dialIn.profile.manualPlaceholder')}
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
          />
          <Button
            variant="dark-brew"
            size="icon"
            onClick={() => onSelect(manualName || t('dialIn.profile.defaultName'))}
            className="shrink-0"
            aria-label={t('a11y.dialIn.submitProfileName')}
          >
            <ArrowRight size={18} />
          </Button>
        </div>
      </div>

      <Button
        variant="ghost"
        className="w-full"
        onClick={() => onSelect(t('dialIn.profile.defaultName'))}
      >
        {t('dialIn.profile.skip')}
      </Button>
    </div>
  )
}
