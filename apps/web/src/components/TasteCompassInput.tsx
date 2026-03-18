import React, { useCallback, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Types ----

export interface TasteData {
  /** -1 (sour) to 1 (bitter) */
  x: number;
  /** -1 (weak) to 1 (strong) */
  y: number;
  /** Selected taste descriptor strings */
  descriptors: string[];
  /** True once the user has interacted */
  hasInput: boolean;
}

export interface TasteCompassInputProps {
  value: TasteData;
  onChange: (data: TasteData) => void;
  disabled?: boolean;
  /** Smaller version for inline use */
  compact?: boolean;
}

// ---- Constants ----

const POSITIVE_DESCRIPTOR_KEYS = [
  "sweet",
  "clean",
  "complex",
  "juicy",
  "smooth",
  "balanced",
  "floral",
  "fruity",
] as const;

const NEGATIVE_DESCRIPTOR_KEYS = [
  "astringent",
  "muddy",
  "flat",
  "chalky",
  "harsh",
  "watery",
  "burnt",
  "grassy",
] as const;

export const DEFAULT_TASTE_DATA: TasteData = {
  x: 0,
  y: 0,
  descriptors: [],
  hasInput: false,
};

// ---- Helpers ----

function describeAxis(
  value: number,
  negativeLabel: string,
  positiveLabel: string,
  balancedLabel: string,
): string {
  const abs = Math.abs(value);
  if (abs < 0.15) return balancedLabel;
  const label = value > 0 ? positiveLabel : negativeLabel;
  if (abs < 0.4) return `${label} (+)`;
  if (abs < 0.7) return `${label} (++)`;
  return `${label} (+++)`;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ---- Compass SVG sub-component ----

interface CompassCanvasProps {
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onEnd: () => void;
  disabled?: boolean;
  compact?: boolean;
}

function CompassCanvas({
  x,
  y,
  onMove,
  onEnd,
  disabled,
  compact,
}: CompassCanvasProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const size = compact ? 200 : 280;
  const half = size / 2;
  const handleRadius = compact ? 14 : 18;
  const padding = 28;
  const usable = half - padding;

  const toSvg = useCallback(
    (vx: number, vy: number) => ({
      cx: half + vx * usable,
      cy: half - vy * usable,
    }),
    [half, usable],
  );

  const fromSvg = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      return {
        x: clamp((px - half) / usable, -1, 1),
        y: clamp(-(py - half) / usable, -1, 1),
      };
    },
    [half, usable],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      const pos = fromSvg(e.clientX, e.clientY);
      onMove(pos.x, pos.y);
    },
    [disabled, fromSvg, onMove],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || disabled) return;
      const pos = fromSvg(e.clientX, e.clientY);
      onMove(pos.x, pos.y);
    },
    [disabled, fromSvg, onMove],
  );

  const handlePointerUp = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = false;
      onEnd();
    }
  }, [onEnd]);

  const { cx, cy } = toSvg(x, y);

  // Quadrant gradient background colors
  const quadrantOpacity = 0.08;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="slider"
      aria-label={t("taste.compass.title")}
      aria-valuetext={`${describeAxis(x, t("taste.compass.sour"), t("taste.compass.bitter"), t("taste.compass.balanced"))}, ${describeAxis(y, t("taste.compass.weak"), t("taste.compass.strong"), t("taste.compass.balanced"))}`}
    >
      {/* Quadrant backgrounds */}
      {/* Top-left: Sour + Strong */}
      <rect
        x={padding}
        y={padding}
        width={usable}
        height={usable}
        fill="orange"
        opacity={quadrantOpacity}
        rx={4}
      />
      {/* Top-right: Bitter + Strong */}
      <rect
        x={half}
        y={padding}
        width={usable}
        height={usable}
        fill="red"
        opacity={quadrantOpacity}
        rx={4}
      />
      {/* Bottom-left: Sour + Weak */}
      <rect
        x={padding}
        y={half}
        width={usable}
        height={usable}
        fill="yellow"
        opacity={quadrantOpacity}
        rx={4}
      />
      {/* Bottom-right: Bitter + Weak */}
      <rect
        x={half}
        y={half}
        width={usable}
        height={usable}
        fill="purple"
        opacity={quadrantOpacity}
        rx={4}
      />

      {/* Grid lines */}
      <line
        x1={half}
        y1={padding}
        x2={half}
        y2={size - padding}
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeDasharray="4 4"
      />
      <line
        x1={padding}
        y1={half}
        x2={size - padding}
        y2={half}
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeDasharray="4 4"
      />

      {/* Axis labels */}
      <text
        x={padding - 2}
        y={half}
        textAnchor="end"
        dominantBaseline="middle"
        className="fill-current text-[10px] opacity-60"
      >
        {t("taste.compass.sour")}
      </text>
      <text
        x={size - padding + 2}
        y={half}
        textAnchor="start"
        dominantBaseline="middle"
        className="fill-current text-[10px] opacity-60"
      >
        {t("taste.compass.bitter")}
      </text>
      <text
        x={half}
        y={padding - 6}
        textAnchor="middle"
        className="fill-current text-[10px] opacity-60"
      >
        {t("taste.compass.strong")}
      </text>
      <text
        x={half}
        y={size - padding + 14}
        textAnchor="middle"
        className="fill-current text-[10px] opacity-60"
      >
        {t("taste.compass.weak")}
      </text>

      {/* Center marker */}
      <circle
        cx={half}
        cy={half}
        r={3}
        className="fill-current opacity-20"
      />

      {/* Drag handle */}
      <circle
        cx={cx}
        cy={cy}
        r={handleRadius}
        className={cn(
          "transition-[r] duration-150",
          disabled
            ? "fill-muted stroke-muted-foreground/30"
            : "fill-primary/90 stroke-primary-foreground/60 cursor-grab active:cursor-grabbing",
        )}
        strokeWidth={2}
        style={{ filter: disabled ? "none" : "drop-shadow(0 1px 3px rgb(0 0 0 / 0.2))" }}
      />
      <circle
        cx={cx}
        cy={cy}
        r={4}
        className={cn(
          disabled ? "fill-muted-foreground/40" : "fill-primary-foreground",
        )}
      />
    </svg>
  );
}

// ---- Descriptor tag buttons ----

interface DescriptorTagsProps {
  selected: string[];
  onToggle: (descriptor: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

function DescriptorTags({
  selected,
  onToggle,
  disabled,
  compact,
}: DescriptorTagsProps) {
  const { t } = useTranslation();

  const renderGroup = (
    descriptors: readonly string[],
    label: string,
    variant: "positive" | "negative",
  ) => (
    <div className="space-y-1.5">
      <span
        className={cn(
          "text-xs font-medium",
          variant === "positive"
            ? "text-green-600 dark:text-green-400"
            : "text-red-600 dark:text-red-400",
        )}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {descriptors.map((d) => {
          const isActive = selected.includes(d);
          return (
            <Badge
              key={d}
              variant={isActive ? "default" : "outline"}
              className={cn(
                "cursor-pointer select-none transition-colors",
                compact ? "text-[10px] px-1.5 py-0" : "text-xs px-2 py-0.5",
                isActive &&
                  variant === "positive" &&
                  "bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 border-green-600",
                isActive &&
                  variant === "negative" &&
                  "bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 border-red-600",
                !isActive && "hover:bg-muted",
                disabled && "pointer-events-none opacity-50",
              )}
              onClick={() => !disabled && onToggle(d)}
            >
              {t(`taste.${variant}Descriptors.${d}`)}
            </Badge>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium">
        {t("taste.compass.descriptors")}
      </span>
      {renderGroup(
        POSITIVE_DESCRIPTOR_KEYS,
        t("taste.compass.positive"),
        "positive",
      )}
      {renderGroup(
        NEGATIVE_DESCRIPTOR_KEYS,
        t("taste.compass.negative"),
        "negative",
      )}
    </div>
  );
}

// ---- Main component ----

export function TasteCompassInput({
  value,
  onChange,
  disabled = false,
  compact = false,
}: TasteCompassInputProps) {
  const { t } = useTranslation();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleMove = useCallback(
    (nx: number, ny: number) => {
      // Round to 2 decimals for cleaner values
      const rx = Math.round(nx * 100) / 100;
      const ry = Math.round(ny * 100) / 100;
      onChange({ ...value, x: rx, y: ry, hasInput: true });
    },
    [onChange, value],
  );

  const handleDragEnd = useCallback(() => {
    // No-op for now; could be used for haptic feedback
  }, []);

  const handleToggleDescriptor = useCallback(
    (descriptor: string) => {
      const next = value.descriptors.includes(descriptor)
        ? value.descriptors.filter((d) => d !== descriptor)
        : [...value.descriptors, descriptor];
      onChange({ ...value, descriptors: next, hasInput: true });
    },
    [onChange, value],
  );

  const handleReset = useCallback(() => {
    onChange(DEFAULT_TASTE_DATA);
  }, [onChange]);

  const balanceLabel = describeAxis(
    value.x,
    t("taste.compass.sour"),
    t("taste.compass.bitter"),
    t("taste.compass.balanced"),
  );
  const bodyLabel = describeAxis(
    value.y,
    t("taste.compass.weak"),
    t("taste.compass.strong"),
    t("taste.compass.balanced"),
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        compact ? "max-w-[240px]" : "max-w-sm",
        prefersReducedMotion && "[&_*]:!transition-none",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3
          className={cn(
            "font-semibold",
            compact ? "text-sm" : "text-base",
          )}
        >
          {t("taste.compass.title")}
        </h3>
        {value.hasInput && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={disabled}
            className="h-7 gap-1 text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            {t("taste.compass.reset")}
          </Button>
        )}
      </div>

      {/* Hint */}
      {!value.hasInput && (
        <p className="text-xs text-muted-foreground">
          {t("taste.compass.hint")}
        </p>
      )}

      {/* Compass */}
      <div className="flex justify-center">
        <CompassCanvas
          x={value.x}
          y={value.y}
          onMove={handleMove}
          onEnd={handleDragEnd}
          disabled={disabled}
          compact={compact}
        />
      </div>

      {/* Current reading */}
      {value.hasInput && (
        <div className="text-center text-xs text-muted-foreground space-x-2">
          <span>{balanceLabel}</span>
          <span>·</span>
          <span>{bodyLabel}</span>
        </div>
      )}

      {/* Descriptor tags */}
      <DescriptorTags
        selected={value.descriptors}
        onToggle={handleToggleDescriptor}
        disabled={disabled}
        compact={compact}
      />
    </div>
  );
}

// ---- API integration hook ----

/**
 * Helper hook that builds FormData taste params for the analyze endpoint.
 * Usage: const { appendTasteParams } = useTasteAnalysis();
 */
export function useTasteAnalysis() {
  const appendTasteParams = useCallback(
    (formData: FormData, taste: TasteData) => {
      if (!taste.hasInput) return;

      formData.append("taste_x", String(taste.x));
      formData.append("taste_y", String(taste.y));

      if (taste.descriptors.length > 0) {
        formData.append("taste_descriptors", taste.descriptors.join(","));
      }
    },
    [],
  );

  return { appendTasteParams };
}

export { POSITIVE_DESCRIPTOR_KEYS, NEGATIVE_DESCRIPTOR_KEYS };
