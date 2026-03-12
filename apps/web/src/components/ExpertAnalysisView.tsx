import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CaretLeft } from "@phosphor-icons/react";
import { Loader2, Sparkles, RefreshCw, XCircle, Info } from "lucide-react";
import { parseStructuredAnalysis } from "@/lib/parseAnalysis";
import { SectionCard } from "@/components/SectionCard";

interface ExpertAnalysisViewProps {
  isLoading: boolean;
  analysisResult: string | null;
  error: string | null;
  onBack: () => void;
  onReAnalyze?: () => void;
  profileName?: string;
  shotDate?: string;
  isCached?: boolean;
}

export function ExpertAnalysisView({
  isLoading,
  analysisResult,
  error,
  onBack,
  onReAnalyze,
  profileName,
  shotDate,
  isCached,
}: ExpertAnalysisViewProps) {
  const { t } = useTranslation();
  const sections = useMemo(() => {
    if (!analysisResult) return [];
    return parseStructuredAnalysis(analysisResult);
  }, [analysisResult]);
  
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="p-6 space-y-5">
        {/* Header with back button */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
          >
            <CaretLeft size={22} weight="bold" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary shrink-0" />
              <h2 className="text-lg font-bold text-foreground truncate">
                {t('expertAnalysis.title')}
              </h2>
              {isCached && (
                <Badge variant="secondary" className="shrink-0">
                  {t('expertAnalysis.cached')}
                </Badge>
              )}
            </div>
            {profileName && shotDate && (
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {profileName} • {shotDate}
              </p>
            )}
          </div>
        </div>

        {/* AI Disclaimer */}
        <Alert className="bg-amber-500/10 border-amber-500/30">
          <Info className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
            {t('expertAnalysis.disclaimer')}
          </AlertDescription>
        </Alert>
        
        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <Sparkles className="h-5 w-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-lg font-medium">{t('expertAnalysis.analyzing')}</p>
              <p className="text-sm text-muted-foreground">{t('expertAnalysis.analyzingDescription')}</p>
            </div>
          </div>
        )}
        
        {/* Error State */}
        {error && !isLoading && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {/* Analysis Content */}
        {!isLoading && !error && sections.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-2">
            {sections.map((section, index) => (
              <SectionCard key={index} section={section} />
            ))}
          </div>
        )}
        
        {/* Fallback: Raw content if no sections parsed */}
        {!isLoading && !error && sections.length === 0 && analysisResult && (
          <Card>
            <CardContent className="pt-6">
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                {analysisResult}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* No Content State */}
        {!isLoading && !error && !analysisResult && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
            <Sparkles className="h-12 w-12 opacity-30" />
            <p className="text-lg">{t('expertAnalysis.noAnalysis')}</p>
          </div>
        )}
        
        {/* Re-Analyze button */}
        {!isLoading && analysisResult && onReAnalyze && (
          <div className="flex items-center justify-center pt-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onReAnalyze}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              {t('expertAnalysis.reAnalyze')}{isCached ? ` ${t('expertAnalysis.forFreshInsights')}` : ''}
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
