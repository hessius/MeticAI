import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { 
  PencilSimple, 
  Eye, 
  FloppyDisk,
  X
} from '@phosphor-icons/react'
import { MarkdownText } from '@/components/MarkdownText'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void | Promise<void>
  onCancel?: () => void
  placeholder?: string
  saving?: boolean
  readOnly?: boolean
  className?: string
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
  saving = false,
  readOnly = false,
  className = '',
}: MarkdownEditorProps) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const handleStartEdit = useCallback(() => {
    setIsEditing(true)
    setShowPreview(false)
  }, [])

  const handleCancel = useCallback(() => {
    setIsEditing(false)
    setShowPreview(false)
    onCancel?.()
  }, [onCancel])

  const handleSave = useCallback(async () => {
    if (!onSave) return
    try {
      await onSave()
      setIsEditing(false)
      setShowPreview(false)
    } catch {
      // Keep editor open on save failure; parent handles error display
    }
  }, [onSave])

  // Read-only mode: just show the content
  if (readOnly) {
    if (!value) return null
    return (
      <div className={className}>
        <MarkdownText text={value} />
      </div>
    )
  }

  // Editing mode
  if (isEditing) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showPreview ? 'outline' : 'secondary'}
            size="sm"
            onClick={() => setShowPreview(false)}
          >
            <PencilSimple className="w-4 h-4 mr-1" />
            {t('markdownEditor.edit')}
          </Button>
          <Button
            variant={showPreview ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowPreview(true)}
          >
            <Eye className="w-4 h-4 mr-1" />
            {t('markdownEditor.preview')}
          </Button>
          <div className="flex-1 min-w-0" />
          <Button
            variant="ghost"
            size="sm"
            data-sound="close"
            onClick={handleCancel}
            disabled={saving}
          >
            <X className="w-4 h-4 mr-1" />
            {t('markdownEditor.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
          >
            <FloppyDisk className="w-4 h-4 mr-1" />
            {saving ? t('markdownEditor.saving') : t('markdownEditor.save')}
          </Button>
        </div>
        
        {showPreview ? (
          <Card className="p-4 min-h-[120px] bg-muted/30">
            {value ? (
              <MarkdownText text={value} />
            ) : (
              <p className="text-muted-foreground text-sm italic">
                {t('markdownEditor.emptyPreview')}
              </p>
            )}
          </Card>
        ) : (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder || t('markdownEditor.placeholder')}
            className="min-h-[120px] font-mono text-sm"
            autoFocus
          />
        )}
      </div>
    )
  }

  // Display mode with edit button
  return (
    <div className={`relative group ${className}`}>
      {value ? (
        <Card className="p-4 bg-muted/30">
          <MarkdownText text={value} />
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleStartEdit}
          >
            <PencilSimple className="w-4 h-4" />
          </Button>
        </Card>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleStartEdit}
          className="w-full justify-start text-muted-foreground"
        >
          <PencilSimple className="w-4 h-4 mr-2" />
          {t('markdownEditor.addNote')}
        </Button>
      )}
    </div>
  )
}
