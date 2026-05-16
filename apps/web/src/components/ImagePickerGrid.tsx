import { useTranslation } from 'react-i18next'
import { CheckCircle, SpinnerGap, WarningCircle } from '@phosphor-icons/react'

export interface BatchImage {
  index: number
  image: string | null
  error?: string
}

export interface ImagePickerGridProps {
  images: BatchImage[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  loading: boolean[]
  onRegenerate?: (index: number) => void
}

export function ImagePickerGrid({
  images,
  selectedIndex,
  onSelect,
  loading,
  onRegenerate,
}: ImagePickerGridProps) {
  const { t } = useTranslation()

  const gridCols = images.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-center text-muted-foreground">
        {t('imageGeneration.selectImage')}
      </p>
      <div className={`grid ${gridCols} gap-3`}>
        {images.map((img, i) => {
          const isLoading = loading[i] ?? false
          const isSelected = selectedIndex === img.index
          const hasError = !!img.error && !img.image

          return (
            <button
              key={img.index}
              type="button"
              disabled={isLoading || hasError}
              onClick={() => onSelect(img.index)}
              className={`
                relative aspect-square rounded-xl overflow-hidden border-2 transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                ${isSelected
                  ? 'border-primary ring-2 ring-primary/30 shadow-lg'
                  : 'border-border/40 hover:border-border/70'}
                ${isLoading || hasError ? 'cursor-default opacity-80' : 'cursor-pointer'}
              `}
              aria-label={`${t('imageGeneration.selectImage')} ${img.index + 1}`}
              aria-pressed={isSelected}
            >
              {/* Image */}
              {img.image && !isLoading && (
                <img
                  src={img.image}
                  alt={`Generated option ${img.index + 1}`}
                  className="w-full h-full object-cover"
                />
              )}

              {/* Loading state */}
              {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary/60">
                  <SpinnerGap
                    size={32}
                    className="animate-spin text-muted-foreground"
                    weight="bold"
                    data-testid={`spinner-${img.index}`}
                  />
                  <span className="text-xs text-muted-foreground mt-2">
                    {t('imageGeneration.generating')}
                  </span>
                </div>
              )}

              {/* Error state */}
              {hasError && !isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 gap-2">
                  <WarningCircle size={28} className="text-destructive" weight="bold" />
                  <span className="text-xs text-destructive px-2 text-center">
                    {img.error}
                  </span>
                  {onRegenerate && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRegenerate(img.index)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          onRegenerate(img.index)
                        }
                      }}
                      className="text-xs text-primary underline hover:no-underline cursor-pointer"
                    >
                      {t('imageGeneration.regenerateSlot')}
                    </span>
                  )}
                </div>
              )}

              {/* Selected checkmark overlay */}
              {isSelected && img.image && !isLoading && (
                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                  <div className="bg-primary rounded-full p-1 shadow-lg" data-testid="checkmark">
                    <CheckCircle size={32} className="text-primary-foreground" weight="fill" />
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
