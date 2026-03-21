import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowRight,
  Check,
  Info,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { Recommendation } from "@/lib/parseAnalysis";

interface RecommendationSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendations: Recommendation[];
  profileName: string;
  onApply: (selected: Recommendation[]) => Promise<void>;
}

const CONFIDENCE_STYLES: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  high: {
    bg: "bg-green-500/15",
    text: "text-green-700 dark:text-green-400",
    border: "border-green-500/30",
  },
  medium: {
    bg: "bg-yellow-500/15",
    text: "text-yellow-700 dark:text-yellow-400",
    border: "border-yellow-500/30",
  },
  low: {
    bg: "bg-orange-500/15",
    text: "text-orange-700 dark:text-orange-400",
    border: "border-orange-500/30",
  },
};

export function RecommendationSelectionDialog({
  open,
  onOpenChange,
  recommendations,
  profileName,
  onApply,
}: RecommendationSelectionDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Group recommendations by stage
  const grouped = useMemo(() => {
    const groups: Record<string, { rec: Recommendation; index: number }[]> = {};
    recommendations.forEach((rec, index) => {
      const stage = rec.stage || "global";
      if (!groups[stage]) groups[stage] = [];
      groups[stage].push({ rec, index });
    });
    return groups;
  }, [recommendations]);

  const patchableCount = useMemo(
    () => recommendations.filter((r) => r.is_patchable).length,
    [recommendations],
  );

  const toggleSelection = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const selectAllPatchable = useCallback(() => {
    setSelected(
      new Set(
        recommendations
          .map((r, i) => (r.is_patchable ? i : -1))
          .filter((i) => i >= 0),
      ),
    );
  }, [recommendations]);

  const handleApply = useCallback(async () => {
    const selectedRecs = recommendations.filter((_, i) => selected.has(i));
    if (selectedRecs.length === 0) return;
    setIsApplying(true);
    try {
      await onApply(selectedRecs);
      setApplied(true);
      setTimeout(() => {
        onOpenChange(false);
        setApplied(false);
        setSelected(new Set());
      }, 1500);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('recommendations.applyFailed'),
      );
    } finally {
      setIsApplying(false);
    }
  }, [recommendations, selected, onApply, onOpenChange, t]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isApplying) {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setSelected(new Set());
          setApplied(false);
        }
      }
    },
    [isApplying, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t("recommendations.apply")}
          </DialogTitle>
          <DialogDescription className="break-words">
            {t("recommendations.selectChanges")} — {profileName}
          </DialogDescription>
        </DialogHeader>

        {recommendations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Info className="mb-2 h-8 w-8 opacity-40" />
            <p>{t("recommendations.noRecommendations")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Select all toggle */}
            {patchableCount > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllPatchable}
                className="text-xs"
              >
                {selected.size === patchableCount
                  ? t("recommendations.deselectAll", "Deselect all")
                  : t("recommendations.selectAll", "Select all patchable")}
              </Button>
            )}

            {Object.entries(grouped).map(([stage, items]) => (
              <div key={stage} className="space-y-2" role="group" aria-labelledby={`stage-${stage}`}>
                <h4 id={`stage-${stage}`} className="text-sm font-semibold capitalize text-muted-foreground">
                  {stage === "global" ? t("recommendations.globalSettings", "Global Settings") : stage}
                </h4>
                <AnimatePresence>
                  {items.map(({ rec, index }) => {
                    const confidence =
                      CONFIDENCE_STYLES[rec.confidence] ??
                      CONFIDENCE_STYLES.low;
                    const isPatchable = rec.is_patchable;
                    const isSelected = selected.has(index);

                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.04 }}
                        className={`flex items-start gap-2 sm:gap-3 rounded-lg border p-2 sm:p-3 transition-colors ${
                          isPatchable
                            ? isSelected
                              ? "border-primary/40 bg-primary/5"
                              : "hover:bg-muted/50"
                            : "border-dashed opacity-60"
                        }`}
                      >
                        {/* Checkbox / Info icon */}
                        <div className="pt-0.5 shrink-0">
                          {isPatchable ? (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelection(index)}
                              aria-label={t('a11y.recommendations.selectVariable', { variable: rec.variable })}
                            />
                          ) : (
                            <Info className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                            <span className="font-mono text-xs sm:text-sm font-medium break-all">
                              {rec.variable}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${confidence.bg} ${confidence.text} ${confidence.border}`}
                            >
                              {t(`recommendations.confidence.${rec.confidence}`)}
                            </Badge>
                            {!isPatchable && (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {t("recommendations.infoOnly")}
                              </Badge>
                            )}
                          </div>

                          {/* Value change */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm">
                            <span className="text-muted-foreground">
                              <span className="font-mono">
                                {rec.current_value}
                              </span>
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-mono font-semibold text-foreground">
                              {rec.recommended_value}
                            </span>
                          </div>

                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {rec.reason}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <AnimatePresence mode="wait">
            {applied ? (
              <motion.div
                key="applied"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400"
              >
                <Check className="h-4 w-4" />
                {t("recommendations.applied")}
              </motion.div>
            ) : (
              <Button
                key="apply-btn"
                onClick={handleApply}
                disabled={selected.size === 0 || isApplying}
                className="gap-2"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("recommendations.applying")}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {t("recommendations.apply")} ({selected.size})
                  </>
                )}
              </Button>
            )}
          </AnimatePresence>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
