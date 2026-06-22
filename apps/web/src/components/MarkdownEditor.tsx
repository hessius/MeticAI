import { useState, useCallback, type ReactNode } from 'react'
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
  /** Section title rendered on the same line as the inline Edit button. */
  title?: ReactNode
  /** Extra header content (e.g. a rating) shown next to the Edit button. */
  headerExtra?: ReactNode
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
  title,
  headerExtra,
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

  // Shared header: section title + a subtle inline Edit button (matches the
  // "Edit Profile" affordance). The Edit button only shows in display mode
  // when there is a note to edit; an empty note uses the "Add a note" button.
  const header = (title || headerExtra) ? (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">{title}</div>
      <div className="flex items-center gap-1 shrink-0">
        {headerExtra}
        {!isEditing && value && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground/60 hover:text-foreground gap-1"
            onClick={handleStartEdit}
            title={t('markdownEditor.editNote')}
            aria-label={t('markdownEditor.editNote')}
          >
            <PencilSimple size={14} weight="bold" />
            {t('markdownEditor.editNote')}
          </Button>
        )}
      </div>
    </div>
  ) : null

  // Editing mode
  if (isEditing) {
    return (
      <div className={`space-y-2 ${className}`}>
        {header}
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

  // Display mode
  return (
    <div className={`space-y-2 ${className}`}>
      {header}
      {value ? (
        <Card className="p-4 bg-muted/30">
          <MarkdownText text={value} />
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
