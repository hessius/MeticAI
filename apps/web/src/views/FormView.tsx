import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Camera, Sparkle, Warning, Upload, X, Coffee, CaretLeft } from '@phosphor-icons/react'
import { PRESET_TAGS, getTagColorClass } from '@/lib/tags'
import { AdvancedCustomization, AdvancedCustomizationOptions } from '@/components/AdvancedCustomization'
import { ProfileRecommendations } from '@/components/ProfileRecommendations'
import type { RefObject, ChangeEvent, DragEvent } from 'react'

interface FormViewProps {
  imagePreview: string | null
  userPrefs: string
  selectedTags: string[]
  advancedOptions: AdvancedCustomizationOptions
  errorMessage: string
  canSubmit: boolean
  profileCount: number | null
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void
  onFileDrop: (file: File) => void
  onRemoveImage: () => void
  onUserPrefsChange: (value: string) => void
  onToggleTag: (tag: string) => void
  onAdvancedOptionsChange: (options: AdvancedCustomizationOptions) => void
  onSubmit: () => void
  onBack: () => void
  onViewHistory: () => void
}

export function FormView({
  imagePreview,
  userPrefs,
  selectedTags,
  advancedOptions,
  errorMessage,
  canSubmit,
  profileCount,
  fileInputRef,
  onFileSelect,
  onFileDrop,
  onRemoveImage,
  onUserPrefsChange,
  onToggleTag,
  onAdvancedOptionsChange,
  onSubmit,
  onBack,
  onViewHistory
}: FormViewProps) {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging to false if we're leaving the drop zone (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file.type.startsWith('image/')) {
        onFileDrop(file)
      }
    }
  }, [onFileDrop])

  return (
    <motion.div
      key="form"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="p-6 space-y-6">
        {/* Header with back button */}
        <div className="flex items-center gap-3 -mt-1 -mx-1">
          <Button
            variant="ghost"
            size="icon"
            data-sound="back"
            onClick={onBack}
            className="shrink-0"
            aria-label={t('common.back')}
          >
            <CaretLeft size={22} weight="bold" />
          </Button>
          <h2 className="text-lg font-bold tracking-tight">{t('navigation.newProfile')}</h2>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-semibold tracking-wide text-foreground/90">
            {t('profileGeneration.coffeeBagPhoto')} <span className="text-muted-foreground font-normal">({t('profileGeneration.optional')})</span>
          </Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileSelect}
            className="hidden"
            id="file-upload"
          />
          
          {!imagePreview ? (
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <label htmlFor="file-upload">
                <motion.div 
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className={`border-2 border-dashed rounded-2xl p-10 cursor-pointer transition-all duration-200 group ${
                    isDragging 
                      ? 'border-primary bg-primary/10 scale-[1.02]' 
                      : 'border-border/50 hover:border-primary/50 bg-secondary/40 hover:bg-secondary/60'
                  }`}
                >
                  <div className={`flex flex-col items-center gap-4 transition-colors duration-200 ${
                    isDragging ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  }`}>
                    <div className="flex gap-3">
                      <Camera size={28} weight="duotone" className={isDragging ? 'text-primary' : 'group-hover:text-primary transition-colors'} />
                      <Upload size={28} weight="duotone" className={isDragging ? 'text-primary' : 'group-hover:text-primary transition-colors'} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">
                        {isDragging ? t('profileGeneration.dropImage') : t('profileGeneration.tapToUpload')}
                      </p>
                      <p className="text-xs mt-1.5 text-muted-foreground">{t('profileGeneration.imageFormats')}</p>
                    </div>
                  </div>
                </motion.div>
              </label>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative rounded-2xl overflow-hidden border-2 border-primary/40 shadow-lg"
            >
              <img 
                src={imagePreview} 
                alt="Coffee bag preview" 
                className="w-full h-48 object-cover"
              />
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onRemoveImage}
                className="absolute top-3 right-3 p-2 bg-black/70 hover:bg-destructive rounded-xl transition-colors backdrop-blur-sm"
              >
                <X size={18} weight="bold" />
              </motion.button>
            </motion.div>
          )}
        </div>

        <div className="space-y-3">
          <Label htmlFor="preferences" className="text-sm font-semibold tracking-wide text-foreground/90">
            {t('profileGeneration.tastePreferences')} <span className="text-muted-foreground font-normal">({t('profileGeneration.optional')})</span>
          </Label>
          
          <div className="space-y-4">
            <Textarea
              id="preferences"
              value={userPrefs}
              onChange={(e) => onUserPrefsChange(e.target.value)}
              placeholder={t('profileGeneration.placeholderText')}
              className="min-h-[90px] resize-none bg-secondary/50 border-border/50 focus:border-primary/60 focus:bg-secondary/80 transition-all duration-200 rounded-xl text-sm placeholder:text-muted-foreground/60"
            />
            
            <div className="space-y-2.5">
              <p className="text-xs text-muted-foreground font-medium">{t('profileGeneration.selectPresetTags')}</p>
              <div className="flex flex-wrap gap-2">
                {PRESET_TAGS.map((tag) => {
                  const isSelected = selectedTags.includes(tag.label)
                  return (
                    <motion.button
                      key={tag.label}
                      onClick={() => onToggleTag(tag.label)}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className="relative"
                    >
                      <Badge
                        variant="outline"
                        className={`
                          px-3 py-1.5 text-xs font-medium cursor-pointer transition-all duration-200
                          ${getTagColorClass(tag.label, isSelected)}
                        `}
                      >
                        {tag.label}
                      </Badge>
                    </motion.button>
                  )
                })}
              </div>
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground/80 mt-3">
            {t('profileGeneration.describeFlavor')}
          </p>
        </div>

        <ProfileRecommendations
          tags={selectedTags}
        />

        <AdvancedCustomization
          value={advancedOptions}
          onChange={onAdvancedOptionsChange}
        />

        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
              <Warning size={18} weight="fill" />
              <AlertDescription className="text-sm">{errorMessage}</AlertDescription>
            </Alert>
          </motion.div>
        )}

        <div className="space-y-3 pt-2">
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            variant="dark-brew"
            className="w-full h-13 text-base transition-all duration-200"
          >
            <Sparkle size={18} weight="fill" className="mr-1" />
            {t('profileGeneration.generateProfile')}
          </Button>
          
          {/* Only show catalogue button when no profiles exist (no back button visible) */}
          {(profileCount === null || profileCount === 0) && (
            <Button
              onClick={onViewHistory}
              variant="ghost"
              className="w-full h-11 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Coffee size={18} className="mr-2" weight="fill" />
              {t('history.title')}
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
