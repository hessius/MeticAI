import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CaretLeft } from "@phosphor-icons/react";
import { 
  Loader2, 
  Sparkles, 
  Info, 
  RefreshCw,
  Target,
  Wrench,
  Lightbulb,
  TrendingUp,
  XCircle,
  AlertCircle
} from "lucide-react";

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

// Section configuration with colors and icons
const SECTION_CONFIG: Record<string, { icon: React.ReactNode; color: string; borderColor: string }> = {
  "1. Shot Performance": {
    icon: <Target className="h-5 w-5" />,
    color: "text-blue-600 dark:text-blue-400",
    borderColor: "border-blue-500/30"
  },
  "2. Root Cause Analysis": {
    icon: <AlertCircle className="h-5 w-5" />,
    color: "text-amber-600 dark:text-amber-400",
    borderColor: "border-amber-500/30"
  },
  "3. Setup Recommendations": {
    icon: <Wrench className="h-5 w-5" />,
    color: "text-green-600 dark:text-green-400",
    borderColor: "border-green-500/30"
  },
  "4. Profile Recommendations": {
    icon: <TrendingUp className="h-5 w-5" />,
    color: "text-purple-600 dark:text-purple-400",
    borderColor: "border-purple-500/30"
  },
  "5. Profile Design Observations": {
    icon: <Lightbulb className="h-5 w-5" />,
    color: "text-cyan-600 dark:text-cyan-400",
    borderColor: "border-cyan-500/30"
  }
};

interface ParsedSection {
  title: string;
  number: string;
  content: string;
  subsections: { title: string; items: string[] }[];
  assessment?: { status: string; color: string };
}

function parseStructuredAnalysis(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  
  const sectionRegex = /^## (\d+)\.\s+(.+)$/gm;
  const matches = [...text.matchAll(sectionRegex)];
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const number = match[1];
    const title = `${number}. ${match[2].trim()}`;
    const startIndex = match.index! + match[0].length;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const sectionContent = text.slice(startIndex, endIndex).trim();
    
    const subsections: { title: string; items: string[] }[] = [];
    const subsectionRegex = /\*\*([^*]+):\*\*/g;
    const subsectionMatches = [...sectionContent.matchAll(subsectionRegex)];
    
    for (let j = 0; j < subsectionMatches.length; j++) {
      const subMatch = subsectionMatches[j];
      const subTitle = subMatch[1].trim();
      const subStart = subMatch.index! + subMatch[0].length;
      const subEnd = j < subsectionMatches.length - 1 ? subsectionMatches[j + 1].index! : sectionContent.length;
      const subContent = sectionContent.slice(subStart, subEnd).trim();
      
      const items = subContent
        .split('\n')
        .map(line => line.replace(/^[-•]\s*/, '').trim())
        .filter(line => line.length > 0 && !line.startsWith('**'));
      
      if (items.length > 0) {
        subsections.push({ title: subTitle, items });
      }
    }
    
    let assessment: { status: string; color: string } | undefined;
    const assessmentMatch = sectionContent.match(/\*\*Assessment:\*\*\s*\[?([^\]\n]+)\]?/i);
    if (assessmentMatch) {
      const status = assessmentMatch[1].trim();
      let color = "bg-gray-500";
      if (status.toLowerCase().includes("good")) color = "bg-green-500";
      else if (status.toLowerCase().includes("acceptable")) color = "bg-yellow-500";
      else if (status.toLowerCase().includes("needs improvement")) color = "bg-orange-500";
      else if (status.toLowerCase().includes("problematic")) color = "bg-red-500";
      assessment = { status, color };
    }
    
    sections.push({
      title,
      number,
      content: sectionContent,
      subsections,
      assessment
    });
  }
  
  return sections;
}

// Circled number characters for section numbering
const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

function SectionCard({ section }: { section: ParsedSection }) {
  const config = SECTION_CONFIG[section.title] || {
    icon: <Info className="h-5 w-5" />,
    color: "text-gray-600 dark:text-gray-400",
    borderColor: "border-gray-500/30"
  };
  
  return (
    <Card className={`${config.borderColor} border-2 overflow-hidden`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <span className={`shrink-0 ${config.color}`}>{config.icon}</span>
          <span className="text-foreground font-semibold">{section.title}</span>
          {section.assessment && (
            <Badge className={`${section.assessment.color} text-white shrink-0`}>
              {section.assessment.status}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {section.subsections.map((subsection, idx) => (
          <div key={idx} className="space-y-2">
            <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <span className={`text-base shrink-0 ${config.color}`}>{CIRCLED_NUMBERS[idx] || `${idx + 1}.`}</span>
              <span className="break-words">{subsection.title}</span>
            </h4>
            <ul className="space-y-1.5 pl-6">
              {subsection.items.map((item, itemIdx) => (
                <li key={itemIdx} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-primary shrink-0 leading-relaxed">•</span>
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
            {idx < section.subsections.length - 1 && (
              <Separator className="mt-3" />
            )}
          </div>
        ))}
        
        {section.subsections.length === 0 && (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {section.content}
          </div>
        )}
      </CardContent>
    </Card>
  );
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
  useEffect(() => {
    console.log('[ExpertAnalysisView] Props:', { isLoading, hasResult: !!analysisResult, error, isCached });
  }, [isLoading, analysisResult, error, isCached]);

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
                AI Shot Analysis
              </h2>
              {isCached && (
                <Badge variant="secondary" className="shrink-0">
                  Cached
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
            This analysis is generated by AI based on shot data. Results should be used as guidance, 
            not absolute truth. Always trust your own taste preferences.
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
              <p className="text-lg font-medium">Analyzing Shot Data</p>
              <p className="text-sm text-muted-foreground">Our AI barista is reviewing your extraction...</p>
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
          <div className="space-y-6 lg:columns-2 lg:gap-6 lg:[&>*]:break-inside-avoid lg:[&>*]:mb-6 lg:space-y-0">
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
            <p className="text-lg">No analysis available</p>
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
              Re-Analyze{isCached ? ' for Fresh Insights' : ''}
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
