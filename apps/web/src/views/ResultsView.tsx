import { motion } from 'framer-motion'
import { useMemo, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, Info, Play, CaretLeft, Image, FileJs, Coffee } from '@phosphor-icons/react'
import { MarkdownText, cleanProfileName } from '@/components/MarkdownText'
import { MeticAILogo } from '@/components/MeticAILogo'
import { ProfileBreakdown, ProfileData } from '@/components/ProfileBreakdown'
import type { APIResponse } from '@/types'

function parseProfileSections(text: string) {
  const sections: { title: string; content: string }[] = []
  const sectionHeaders = [
    'Description',
    'Preparation',
    'Why This Works',
    'Special Notes'
  ]
  
  const remainingText = text
  
  sectionHeaders.forEach((header, index) => {
    const headerPattern = new RegExp(`\\*?\\*?${header}:\\*?\\*?\\s*`, 'i')
    const match = remainingText.match(headerPattern)
    
    if (match && match.index !== undefined) {
      const startIndex = match.index + match[0].length
      
      let endIndex = remainingText.length
      for (let i = index + 1; i < sectionHeaders.length; i++) {
        const nextHeaderPattern = new RegExp(`\\*?\\*?${sectionHeaders[i]}:`, 'ig')
        let nextMatch: RegExpExecArray | null
        // Search forward from startIndex to ensure monotonic section boundaries
        while ((nextMatch = nextHeaderPattern.exec(remainingText)) !== null) {
          if (nextMatch.index >= startIndex) {
            endIndex = nextMatch.index
            break
          }
        }
        if (endIndex < remainingText.length) break
      }
      
      let content = remainingText.substring(startIndex, endIndex).trim()
      
      content = content.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '')
      content = content.replace(/\n*---\s*$/g, '').trim()
      
      const jsonSectionIndex = content.indexOf('PROFILE JSON')
      if (jsonSectionIndex > 0) {
        content = content.substring(0, jsonSectionIndex).trim()
      }
      content = content.replace(/```json[\s\S]*?```/g, '').trim()
      content = content.replace(/```[\s\S]*?```/g, '').trim()
      
      if (content) {
        sections.push({ title: header, content })
      }
    }
  })
  
  return sections
}

interface ResultsViewProps {
  apiResponse: APIResponse
  currentProfileJson: Record<string, unknown> | null
  createdProfileId: string | null
  isCapturing: boolean
  resultsCardRef: RefObject<HTMLDivElement | null>
  onBack: () => void
  onSaveResults: () => void
  onDownloadJson: () => void
  onViewHistory: () => void
  onRunProfile: () => void
}

export function ResultsView({
  apiResponse,
  currentProfileJson,
  createdProfileId,
  isCapturing,
  resultsCardRef,
  onBack,
  onSaveResults,
  onDownloadJson,
  onViewHistory,
  onRunProfile
}: ResultsViewProps) {
  const sections = useMemo(() => parseProfileSections(apiResponse.reply), [apiResponse.reply])
  const profileName = useMemo(() => {
    const profileNameMatch = apiResponse.reply.match(/Profile Created:\s*(.+?)(?:\n|$)/i)
    return cleanProfileName(profileNameMatch?.[1]?.trim() || '')
  }, [apiResponse.reply])

  return (
    <motion.div
      key="results"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ 
        type: "spring",
        stiffness: 300,
        damping: 25
      }}
    >
      <div ref={resultsCardRef} className={isCapturing ? 'w-[400px] mx-auto' : ''}>
        {isCapturing && (
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-3 mb-2">
              <MeticAILogo size={40} variant="white" />
              <h1 className="text-4xl font-bold tracking-tight">
                Metic<span className="text-primary">AI</span>
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">Meticulous Espresso AI Profiler</p>
          </div>
        )}
        <Card className={`p-6 ${isCapturing ? 'space-y-4' : 'space-y-5'}`}>
          {(() => {
            if (isCapturing && profileName) {
              return (
                <div className="text-success w-full">
                  <h2 className="text-2xl font-bold break-words">{profileName}</h2>
                </div>
              )
            }
            
            return (
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onBack}
                  className="shrink-0"
                  title="Back to form"
                  aria-label="Back to form"
                >
                  <CaretLeft size={22} weight="bold" />
                </Button>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="p-2 rounded-xl bg-success/10 shrink-0">
                    <CheckCircle size={24} weight="fill" className="text-success" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-foreground break-words leading-tight">
                      {profileName || 'Profile Generated!'}
                    </h2>
                    <p className="text-xs text-muted-foreground">Profile saved to device</p>
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="space-y-4">
            {apiResponse.analysis && apiResponse.analysis.trim() && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="space-y-2"
              >
                <Label className="text-sm font-semibold tracking-wide text-primary">
                  Coffee Analysis
                </Label>
                <div className="p-4 bg-secondary/50 dark:bg-secondary/60 rounded-xl border border-border/50">
                  <p className="text-sm leading-relaxed text-foreground/90">
                    <MarkdownText>{apiResponse.analysis}</MarkdownText>
                  </p>
                </div>
              </motion.div>
            )}

            {sections.length > 0 ? (
              <div className="space-y-3">
                {sections.map((section, index) => (
                  <motion.div 
                    key={index} 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + index * 0.05 }}
                    className="space-y-2"
                  >
                    <Label className="text-sm font-semibold tracking-wide text-primary">
                      {section.title}
                    </Label>
                    <div className="p-4 bg-secondary/50 dark:bg-secondary/60 rounded-xl border border-border/50">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                        <MarkdownText>{section.content}</MarkdownText>
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm font-semibold tracking-wide text-primary">
                  Profile
                </Label>
                <div className="p-4 bg-secondary/50 dark:bg-secondary/60 rounded-xl border border-border/50">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                    <MarkdownText>{apiResponse.reply}</MarkdownText>
                  </p>
                </div>
              </div>
            )}
          </div>

          {currentProfileJson && (
            <ProfileBreakdown profile={currentProfileJson as ProfileData} />
          )}

          {!isCapturing && (
            <>
              <Alert className="bg-success/8 border-success/20 rounded-xl">
                <Info className="h-4 w-4 text-success" />
                <AlertDescription className="text-sm text-foreground/80">
                  Profile has been saved to your Meticulous device and history
                </AlertDescription>
              </Alert>

              {createdProfileId && currentProfileJson?.name && (
                <Button
                  onClick={onRunProfile}
                  variant="dark-brew"
                  className="w-full h-12 text-sm font-semibold"
                >
                  <Play size={18} className="mr-1.5" weight="fill" />
                  Run / Schedule Shot
                </Button>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground block text-center">Export as</Label>
                <div className={`grid gap-2.5 ${currentProfileJson ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <Button
                    onClick={onSaveResults}
                    variant="outline"
                    className="h-11 text-sm font-semibold"
                    title="Save results as image"
                  >
                    <Image size={18} className="mr-1.5" weight="bold" />
                    Image
                  </Button>
                  {currentProfileJson && (
                    <Button
                      onClick={onDownloadJson}
                      variant="outline"
                      className="h-11 text-sm font-semibold"
                    >
                      <FileJs size={18} className="mr-1.5" weight="bold" />
                      JSON
                    </Button>
                  )}
                </div>
              </div>

              <Button
                onClick={onViewHistory}
                variant={createdProfileId ? "outline" : "dark-brew"}
                className="w-full h-12 text-sm font-semibold"
              >
                <Coffee size={18} className="mr-1.5" weight="fill" />
                Profile Catalogue
              </Button>
            </>
          )}
        </Card>
      </div>
    </motion.div>
  )
}
