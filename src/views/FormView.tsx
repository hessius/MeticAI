import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Camera, Sparkle, Warning, Upload, X, Coffee, CaretLeft } from '@phosphor-icons/react'
import { PRESET_TAGS, CATEGORY_COLORS } from '@/lib/tags'
import { AdvancedCustomization, AdvancedCustomizationOptions } from '@/components/AdvancedCustomization'
import type { RefObject, ChangeEvent } from 'react'

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
  onRemoveImage,
  onUserPrefsChange,
  onToggleTag,
  onAdvancedOptionsChange,
  onSubmit,
  onBack,
  onViewHistory
}: FormViewProps) {
  const getCategoryColor = (category: string) => {
    return CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || ''
  }

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
            onClick={onBack}
            className="shrink-0"
            aria-label="Back"
          >
            <CaretLeft size={22} weight="bold" />
          </Button>
          <h2 className="text-lg font-bold tracking-tight">New Profile</h2>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-semibold tracking-wide text-foreground/90">
            Coffee Bag Photo <span className="text-muted-foreground font-normal">(Optional)</span>
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
            <label htmlFor="file-upload">
              <motion.div 
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className="border-2 border-dashed border-border/60 hover:border-primary/50 rounded-2xl p-10 cursor-pointer transition-all duration-200 group bg-secondary/30 hover:bg-secondary/50"
              >
                <div className="flex flex-col items-center gap-4 text-muted-foreground group-hover:text-foreground transition-colors duration-200">
                  <div className="flex gap-3">
                    <Camera size={28} weight="duotone" className="group-hover:text-primary transition-colors" />
                    <Upload size={28} weight="duotone" className="group-hover:text-primary transition-colors" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">Tap to upload or take photo</p>
                    <p className="text-xs mt-1.5 text-muted-foreground">JPG, PNG, or other image formats</p>
                  </div>
                </div>
              </motion.div>
            </label>
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
            Taste Preferences <span className="text-muted-foreground font-normal">(Optional)</span>
          </Label>
          
          <div className="space-y-4">
            <Textarea
              id="preferences"
              value={userPrefs}
              onChange={(e) => onUserPrefsChange(e.target.value)}
              placeholder="e.g., Balanced extraction, nutty notes..."
              className="min-h-[90px] resize-none bg-secondary/50 border-border/50 focus:border-primary/60 focus:bg-secondary/80 transition-all duration-200 rounded-xl text-sm placeholder:text-muted-foreground/60"
            />
            
            <div className="space-y-2.5">
              <p className="text-xs text-muted-foreground font-medium">Or select preset tags:</p>
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
                        variant={isSelected ? "default" : "outline"}
                        className={`
                          px-3 py-1.5 text-xs font-medium cursor-pointer transition-all duration-200
                          ${isSelected 
                            ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20' 
                            : `${getCategoryColor(tag.category)} border`
                          }
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
            Describe your ideal espresso flavor profile using text, tags, or both
          </p>
        </div>

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
            className="w-full h-13 text-base font-semibold transition-all duration-200"
          >
            <Sparkle size={18} weight="fill" className="mr-1" />
            Generate Profile
          </Button>
          
          {/* Only show catalogue button when no profiles exist (no back button visible) */}
          {(profileCount === null || profileCount === 0) && (
            <Button
              onClick={onViewHistory}
              variant="ghost"
              className="w-full h-11 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Coffee size={18} className="mr-2" weight="fill" />
              Profile Catalogue
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
