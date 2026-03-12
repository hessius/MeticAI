import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { PencilSimple, Star } from '@phosphor-icons/react'
import { MarkdownEditor } from '@/components/MarkdownEditor'
import { getServerUrl } from '@/lib/config'

interface ShotAnnotationProps {
  date: string
  filename: string
  className?: string
  onAnnotationChange?: (hasAnnotation: boolean, rating: number | null) => void
}

function StarRating({ value, onChange }: { value: number | null; onChange: (rating: number | null) => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={t('shotAnnotation.ratingLabel')}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(value === star ? null : star)}
          className="p-0.5 transition-colors hover:scale-110 active:scale-95"
          aria-label={t('shotAnnotation.ratingStar', { star })}
        >
          <Star
            size={22}
            weight={value !== null && star <= value ? 'fill' : 'regular'}
            className={
              value !== null && star <= value
                ? 'text-amber-400'
                : 'text-muted-foreground/40 hover:text-amber-300'
            }
          />
        </button>
      ))}
    </div>
  )
}

export function ShotAnnotation({ date, filename, className = '', onAnnotationChange }: ShotAnnotationProps) {
  const { t } = useTranslation()
  
  const [annotation, setAnnotation] = useState('')
  const [originalAnnotation, setOriginalAnnotation] = useState('')
  const [rating, setRating] = useState<number | null>(null)
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
          setRating(data.rating ?? null)
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
          body: JSON.stringify({ annotation, rating })
        }
      )
      
      if (!response.ok) {
        throw new Error('Failed to save annotation')
      }
      
      setOriginalAnnotation(annotation)
      onAnnotationChange?.(!!annotation.trim() || rating !== null, rating)
      toast.success(t('shotAnnotation.saved'))
    } catch (error) {
      console.error('Failed to save annotation:', error)
      toast.error(t('shotAnnotation.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }, [date, filename, annotation, rating, t, onAnnotationChange])
  
  const handleCancel = useCallback(() => {
    setAnnotation(originalAnnotation)
  }, [originalAnnotation])

  const handleRatingChange = useCallback(async (newRating: number | null) => {
    setRating(newRating)
    // Save rating immediately
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(
        `${serverUrl}/api/shots/${encodeURIComponent(date)}/${encodeURIComponent(filename)}/annotation`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: newRating })
        }
      )
      if (!response.ok) {
        throw new Error('Failed to save rating')
      }
      onAnnotationChange?.(!!annotation.trim() || newRating !== null, newRating)
    } catch (error) {
      console.error('Failed to save rating:', error)
      toast.error(t('shotAnnotation.ratingSaveFailed'))
    }
  }, [date, filename, annotation, t, onAnnotationChange])
  
  if (isLoading) {
    return null // Don't show anything while loading
  }
  
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-2">
          <PencilSimple className="w-4 h-4" />
          {t('shotAnnotation.title')}
        </Label>
        <StarRating value={rating} onChange={handleRatingChange} />
      </div>
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
