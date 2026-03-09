import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { PencilSimple } from '@phosphor-icons/react'
import { MarkdownEditor } from '@/components/MarkdownEditor'
import { getServerUrl } from '@/lib/config'

interface ShotAnnotationProps {
  date: string
  filename: string
  className?: string
}

export function ShotAnnotation({ date, filename, className = '' }: ShotAnnotationProps) {
  const { t } = useTranslation()
  
  const [annotation, setAnnotation] = useState('')
  const [originalAnnotation, setOriginalAnnotation] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  // Fetch existing annotation on mount
  useEffect(() => {
    const fetchAnnotation = async () => {
      setIsLoading(true)
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(
          `${serverUrl}/api/shots/${encodeURIComponent(date)}/${encodeURIComponent(filename)}/annotation`
        )
        if (response.ok) {
          const data = await response.json()
          const text = data.annotation || ''
          setAnnotation(text)
          setOriginalAnnotation(text)
        }
      } catch (error) {
        console.error('Failed to fetch annotation:', error)
      } finally {
        setIsLoading(false)
      }
    }
    
    if (date && filename) {
      fetchAnnotation()
    }
  }, [date, filename])
  
  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(
        `${serverUrl}/api/shots/${encodeURIComponent(date)}/${encodeURIComponent(filename)}/annotation`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotation })
        }
      )
      
      if (!response.ok) {
        throw new Error('Failed to save annotation')
      }
      
      setOriginalAnnotation(annotation)
      toast.success(t('shotAnnotation.saved'))
    } catch (error) {
      console.error('Failed to save annotation:', error)
      toast.error(t('shotAnnotation.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }, [date, filename, annotation, t])
  
  const handleCancel = useCallback(() => {
    setAnnotation(originalAnnotation)
  }, [originalAnnotation])
  
  if (isLoading) {
    return null // Don't show anything while loading
  }
  
  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="text-sm font-medium flex items-center gap-2">
        <PencilSimple className="w-4 h-4" />
        {t('shotAnnotation.title')}
      </Label>
      <MarkdownEditor
        value={annotation}
        onChange={setAnnotation}
        onSave={handleSave}
        onCancel={handleCancel}
        saving={isSaving}
        placeholder={t('markdownEditor.placeholder')}
      />
    </div>
  )
}
