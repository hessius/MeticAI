"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { toPng } from "html-to-image";

/* ───────────────────── Canvas Dimensions ───────────────────── */

// iPhone (6.7" — App Store required)
const W = 1284;
const H = 2778;

// Android phone
const AW = 1080;
const AH = 1920;

// Feature Graphic
const FGW = 1024;
const FGH = 500;

/* ───────────────────── Export Sizes ───────────────────── */

const IPHONE_SIZES = [
  { label: '6.7"', w: 1284, h: 2778 },
  { label: '6.5"', w: 1242, h: 2688 },
] as const;

const ANDROID_SIZES = [{ label: "Phone", w: 1080, h: 1920 }] as const;

const FG_SIZES = [{ label: "Feature Graphic", w: 1024, h: 500 }] as const;

/* ───────────────────── Frame Ratios ───────────────────── */

const MK_W = 1022;
const MK_H = 2082;
const MK_RATIO = MK_W / MK_H;

const SC_L = (52 / MK_W) * 100;
const SC_T = (46 / MK_H) * 100;
const SC_W = (918 / MK_W) * 100;
const SC_H = (1990 / MK_H) * 100;
const SC_RX = (126 / 918) * 100;
const SC_RY = (126 / 1990) * 100;

/* ───────────────────── Width Functions ───────────────────── */

function phoneW(cW: number, cH: number, clamp = 0.84) {
  return Math.min(clamp, 0.72 * (cH / cW) * MK_RATIO);
}

/* ───────────────────── Theme ───────────────────── */

const THEME = {
  accent: "#D77100",
  accentLight: "#FF9D2E",
  bg1: "#0A0A0A",
  bg2: "#1A0A00",
  bg3: "#2D1500",
  fg: "#FFFFFF",
  fgMuted: "rgba(255,255,255,0.7)",
  green: "#A8D600",
  greenDark: "#7BA300",
  violet: "#8B5CF6",
  blue: "#3B82F6",
  orange: "#F97316",
};

/* ───────────────────── Image Cache ───────────────────── */

const IMAGE_PATHS = [
  "/mockup.png",
  "/app-icon.png",
  "/screenshots/en/home.png",
  "/screenshots/en/compass.png",
  "/screenshots/en/create-profile.png",
  "/screenshots/en/pour-over.png",
  "/screenshots/en/shot-analysis.png",
  "/screenshots/en/profile-catalogue.png",
];

const imageCache: Record<string, string> = {};

async function preloadAllImages() {
  await Promise.all(
    IMAGE_PATHS.map(async (path) => {
      const resp = await fetch(path);
      const blob = await resp.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      imageCache[path] = dataUrl;
    })
  );
}

function img(path: string): string {
  return imageCache[path] || path;
}

/* ───────────────────── Types ───────────────────── */

type Device = "iphone" | "android" | "feature-graphic";
type SlideProps = { cW: number; cH: number };
type SlideDef = { id: string; component: (p: SlideProps) => React.JSX.Element };

/* ───────────────────── Device Frame Components ───────────────────── */

function Phone({
  src,
  alt,
  style,
}: {
  src: string;
  alt: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: `${MK_W}/${MK_H}`,
        ...style,
      }}
    >
      <img
        src={img("/mockup.png")}
        alt=""
        style={{ display: "block", width: "100%", height: "100%" }}
        draggable={false}
      />
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          overflow: "hidden",
          left: `${SC_L}%`,
          top: `${SC_T}%`,
          width: `${SC_W}%`,
          height: `${SC_H}%`,
          borderRadius: `${SC_RX}% / ${SC_RY}%`,
        }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            display: "block",
            width: "100%",
            height: "104%",
            marginTop: "-2%",
            objectFit: "cover",
            objectPosition: "top",
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}

function AndroidPhone({
  src,
  alt,
  style,
}: {
  src: string;
  alt: string;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "relative", aspectRatio: "9/19.5", ...style }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "8% / 4%",
          background:
            "linear-gradient(160deg, #2a2a2e 0%, #18181b 100%)",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.08), 0 8px 40px rgba(0,0,0,0.55)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "1.5%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "3%",
            height: "1.4%",
            borderRadius: "50%",
            background: "#0d0d0f",
            border: "1px solid rgba(255,255,255,0.06)",
            zIndex: 20,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "3.5%",
            top: "2%",
            width: "93%",
            height: "96%",
            borderRadius: "5.5% / 2.6%",
            overflow: "hidden",
            background: "#000",
          }}
        >
          <img
            src={src}
            alt={alt}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top",
            }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── Caption Component ───────────────────── */

function Caption({
  cW,
  label,
  headline,
  light = true,
}: {
  cW: number;
  label: string;
  headline: React.ReactNode;
  light?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: `${cW * 0.08}px`,
        left: `${cW * 0.08}px`,
        right: `${cW * 0.08}px`,
        zIndex: 20,
      }}
    >
      <div
        style={{
          fontSize: `${cW * 0.03}px`,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: light ? THEME.green : THEME.accent,
          marginBottom: `${cW * 0.02}px`,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: `${cW * 0.088}px`,
          fontWeight: 700,
          lineHeight: 1.0,
          color: light ? THEME.fg : "#1a1a1a",
          letterSpacing: "-0.02em",
        }}
      >
        {headline}
      </div>
    </div>
  );
}

/* ───────────────────── Decorative Components ───────────────────── */

function GlowBlob({
  color,
  size,
  top,
  left,
  opacity = 0.4,
}: {
  color: string;
  size: string;
  top: string;
  left: string;
  opacity?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        filter: "blur(80px)",
        opacity,
        zIndex: 1,
      }}
    />
  );
}

/* ───────────────────── Slide Definitions ───────────────────── */

type PhoneComp = typeof Phone | typeof AndroidPhone;

function makeSlides(PhoneComp: PhoneComp, basePath: string): SlideDef[] {
  return [
    // Slide 1: Hero — Home Screen
    {
      id: "home",
      component: ({ cW, cH }: SlideProps) => {
        const fw = phoneW(cW, cH) * 100;
        return (
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              overflow: "hidden",
              background: `linear-gradient(165deg, ${THEME.bg1} 0%, ${THEME.bg2} 40%, ${THEME.bg3} 100%)`,
            }}
          >
            <GlowBlob
              color={THEME.accent}
              size="60%"
              top="-10%"
              left="50%"
              opacity={0.25}
            />
            <GlowBlob
              color={THEME.green}
              size="40%"
              top="30%"
              left="-15%"
              opacity={0.15}
            />

            <Caption
              cW={cW}
              label="METIC"
              headline={
                <>
                  Meticulous
                  <br />
                  Unleashed.
                </>
              }
            />

            <PhoneComp
              src={img(`${basePath}/home.png`)}
              alt="Home Screen"
              style={{
                position: "absolute",
                bottom: 0,
                width: `${fw}%`,
                left: "50%",
                transform: "translateX(-50%) translateY(13%)",
              }}
            />

            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: `linear-gradient(90deg, ${THEME.green}, ${THEME.accent})`,
                zIndex: 30,
              }}
            />
          </div>
        );
      },
    },

    // Slide 2: Espresso Compass
    {
      id: "compass",
      component: ({ cW, cH }: SlideProps) => {
        const fw = phoneW(cW, cH) * 100;
        return (
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              overflow: "hidden",
              background:
                "linear-gradient(180deg, #0D1117 0%, #161B22 50%, #0D1117 100%)",
            }}
          >
            <GlowBlob
              color={THEME.blue}
              size="50%"
              top="20%"
              left="60%"
              opacity={0.2}
            />
            <GlowBlob
              color={THEME.violet}
              size="35%"
              top="50%"
              left="-10%"
              opacity={0.15}
            />

            <Caption
              cW={cW}
              label="ESPRESSO COMPASS"
              headline={
                <>
                  Dialing in has
                  <br />
                  never been easier.
                </>
              }
            />

            <PhoneComp
              src={img(`${basePath}/compass.png`)}
              alt="Espresso Compass"
              style={{
                position: "absolute",
                bottom: 0,
                width: `${fw * 0.92}%`,
                right: "-4%",
                transform: "translateY(10%)",
              }}
            />

            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: `linear-gradient(90deg, ${THEME.blue}, ${THEME.violet})`,
                zIndex: 30,
              }}
            />
          </div>
        );
      },
    },

    // Slide 3: AI Profile Creation — bright contrast slide
    {
      id: "create-profile",
      component: ({ cW, cH }: SlideProps) => {
        const fw = phoneW(cW, cH) * 100;
        return (
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              overflow: "hidden",
              background:
                "linear-gradient(165deg, #FFF7ED 0%, #FED7AA 40%, #FDBA74 100%)",
            }}
          >
            <GlowBlob
              color={THEME.accent}
              size="50%"
              top="-5%"
              left="60%"
              opacity={0.3}
            />

            <Caption
              cW={cW}
              label="AI PROFILES"
              headline={
                <>
                  The perfect profile.
                  <br />
                  One prompt away.
                </>
              }
              light={false}
            />

            <PhoneComp
              src={img(`${basePath}/create-profile.png`)}
              alt="AI Profile Creation"
              style={{
                position: "absolute",
                bottom: 0,
                width: `${fw}%`,
                left: "50%",
                transform: "translateX(-45%) translateY(13%)",
              }}
            />
          </div>
        );
      },
    },

    // Slide 4: Pour-Over Recipes
    {
      id: "pour-over",
      component: ({ cW, cH }: SlideProps) => {
        const fw = phoneW(cW, cH) * 100;
        return (
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              overflow: "hidden",
              background: `linear-gradient(165deg, ${THEME.bg1} 0%, #1a0520 50%, #0f0030 100%)`,
            }}
          >
            <GlowBlob
              color={THEME.violet}
              size="55%"
              top="10%"
              left="45%"
              opacity={0.25}
            />
            <GlowBlob
              color={THEME.orange}
              size="30%"
              top="60%"
              left="-5%"
              opacity={0.2}
            />

            <Caption
              cW={cW}
              label="POUR OVER"
              headline={
                <>
                  Great coffee
                  <br />
                  beyond espresso.
                </>
              }
            />

            <PhoneComp
              src={img(`${basePath}/pour-over.png`)}
              alt="Pour Over Recipes"
              style={{
                position: "absolute",
                bottom: 0,
                width: `${fw}%`,
                left: "8%",
                transform: "translateY(13%)",
              }}
            />
          </div>
        );
      },
    },

    // Slide 5: Shot Analysis
    {
      id: "shot-analysis",
      component: ({ cW, cH }: SlideProps) => {
        const fw = phoneW(cW, cH) * 100;
        return (
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              overflow: "hidden",
              background:
                "linear-gradient(165deg, #0A0A0A 0%, #0D1A0D 50%, #0A1A0A 100%)",
            }}
          >
            <GlowBlob
              color={THEME.green}
              size="50%"
              top="15%"
              left="55%"
              opacity={0.2}
            />
            <GlowBlob
              color={THEME.accent}
              size="35%"
              top="45%"
              left="-10%"
              opacity={0.15}
            />

            <Caption
              cW={cW}
              label="SHOT ANALYSIS"
              headline={
                <>
                  Every shot,
                  <br />
                  perfected.
                </>
              }
            />

            <PhoneComp
              src={img(`${basePath}/shot-analysis.png`)}
              alt="Shot Analysis"
              style={{
                position: "absolute",
                bottom: 0,
                width: `${fw * 0.92}%`,
                right: "-4%",
                transform: "translateY(10%)",
              }}
            />

            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: `linear-gradient(90deg, ${THEME.green}, ${THEME.accent})`,
                zIndex: 30,
              }}
            />
          </div>
        );
      },
    },

    // Slide 6: Profile Catalogue
    {
      id: "profile-catalogue",
      component: ({ cW, cH }: SlideProps) => {
        const fw = phoneW(cW, cH) * 100;
        const pills = [
          "Replay",
          "Shot vs Shot",
          "Shot vs Profile",
          "AI Shot Analysis",
          "AI Profile Improvement",
          "Dark Mode",
          "Multi-language",
        ];
        return (
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              overflow: "hidden",
              background:
                "linear-gradient(165deg, #0A0A0A 0%, #1A1A1A 50%, #0A0A0A 100%)",
            }}
          >
            <GlowBlob
              color={THEME.accent}
              size="50%"
              top="5%"
              left="40%"
              opacity={0.15}
            />
            <GlowBlob
              color={THEME.violet}
              size="40%"
              top="50%"
              left="70%"
              opacity={0.1}
            />

            <Caption
              cW={cW}
              label="PROFILE CATALOGUE"
              headline={
                <>
                  Your espresso.
                  <br />
                  Your way.
                </>
              }
            />

            <PhoneComp
              src={img(`${basePath}/profile-catalogue.png`)}
              alt="Profile Catalogue"
              style={{
                position: "absolute",
                bottom: `${cH * 0.18}px`,
                width: `${fw * 0.75}%`,
                left: "50%",
                transform: "translateX(-50%)",
              }}
            />

            <div
              style={{
                position: "absolute",
                bottom: `${cW * 0.06}px`,
                left: `${cW * 0.06}px`,
                right: `${cW * 0.06}px`,
                display: "flex",
                flexWrap: "wrap",
                gap: `${cW * 0.018}px`,
                justifyContent: "center",
                zIndex: 20,
              }}
            >
              {pills.map((p) => (
                <span
                  key={p}
                  style={{
                    padding: `${cW * 0.012}px ${cW * 0.028}px`,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: `${cW * 0.04}px`,
                    color: THEME.fgMuted,
                    fontSize: `${cW * 0.026}px`,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {p}
                </span>
              ))}
            </div>

            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: `linear-gradient(90deg, ${THEME.green}, ${THEME.accent}, ${THEME.violet})`,
                zIndex: 30,
              }}
            />
          </div>
        );
      },
    },
  ];
}

/* ───────────────────── Slide Registries ───────────────────── */

const IPHONE_SLIDES = makeSlides(Phone, "/screenshots/en");
const ANDROID_SLIDES = makeSlides(AndroidPhone, "/screenshots/en");

const FG_SLIDE: SlideDef = {
  id: "feature-graphic",
  component: ({ cW }: SlideProps) => (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(135deg, ${THEME.bg1} 0%, ${THEME.bg2} 50%, ${THEME.bg3} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${cW * 0.06}px`,
      }}
    >
      <GlowBlob
        color={THEME.accent}
        size="40%"
        top="-20%"
        left="60%"
        opacity={0.3}
      />
      <GlowBlob
        color={THEME.green}
        size="30%"
        top="30%"
        left="-10%"
        opacity={0.2}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: cW * 0.03,
          zIndex: 10,
        }}
      >
        <img
          src={img("/app-icon.png")}
          alt="Metic"
          style={{
            width: cW * 0.14,
            height: cW * 0.14,
            borderRadius: cW * 0.025,
          }}
          draggable={false}
        />
        <div>
          <div
            style={{
              fontSize: cW * 0.06,
              fontWeight: 800,
              color: THEME.fg,
              lineHeight: 1.1,
            }}
          >
            Metic
          </div>
          <div
            style={{
              fontSize: cW * 0.025,
              color: THEME.fgMuted,
              marginTop: cW * 0.006,
            }}
          >
            Unleash your meticulous.
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "3px",
          background: `linear-gradient(90deg, ${THEME.green}, ${THEME.accent}, ${THEME.violet})`,
        }}
      />
    </div>
  ),
};

/* ───────────────────── Preview Component ───────────────────── */

function ScreenshotPreview({
  slide,
  cW,
  cH,
  index,
  exportRef,
  onExportSingle,
}: {
  slide: SlideDef;
  cW: number;
  cH: number;
  index: number;
  exportRef: (el: HTMLDivElement | null) => void;
  onExportSingle: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const cw = entry.contentRect.width;
      setScale(cw / cW);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cW]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          aspectRatio: `${cW}/${cH}`,
          overflow: "hidden",
          borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
          cursor: "pointer",
          position: "relative",
        }}
        onClick={onExportSingle}
        title={`Click to export slide ${index + 1}`}
      >
        <div
          style={{
            width: cW,
            height: cH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <slide.component cW={cW} cH={cH} />
        </div>
      </div>

      <div
        ref={exportRef}
        style={{
          position: "absolute",
          left: -9999,
          width: cW,
          height: cH,
          opacity: 0,
        }}
      >
        <slide.component cW={cW} cH={cH} />
      </div>

      <div
        style={{
          textAlign: "center",
          fontSize: 12,
          color: "#6b7280",
          fontWeight: 600,
        }}
      >
        {slide.id}
      </div>
    </div>
  );
}

/* ───────────────────── Main Page ───────────────────── */

export default function ScreenshotsPage() {
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<Device>("iphone");
  const [sizeIdx, setSizeIdx] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const exportRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    preloadAllImages().then(() => setReady(true));
  }, []);

  const { cW, cH, currentSizes, slides } = (() => {
    if (device === "android")
      return {
        cW: AW,
        cH: AH,
        currentSizes: ANDROID_SIZES,
        slides: ANDROID_SLIDES,
      };
    if (device === "feature-graphic")
      return {
        cW: FGW,
        cH: FGH,
        currentSizes: FG_SIZES,
        slides: [FG_SLIDE],
      };
    return {
      cW: W,
      cH: H,
      currentSizes: IPHONE_SIZES,
      slides: IPHONE_SLIDES,
    };
  })();

  const captureSlide = useCallback(
    async (el: HTMLElement, w: number, h: number): Promise<string> => {
      el.style.left = "0px";
      el.style.opacity = "1";
      el.style.zIndex = "-1";

      const opts = { width: w, height: h, pixelRatio: 1, cacheBust: true, backgroundColor: '#000000' };
      await toPng(el, opts);
      const dataUrl = await toPng(el, opts);

      el.style.left = "-9999px";
      el.style.opacity = "0";
      el.style.zIndex = "";
      return dataUrl;
    },
    []
  );

  const exportSingle = useCallback(
    async (index: number) => {
      const el = exportRefs.current[index];
      if (!el) return;
      const size = currentSizes[sizeIdx];
      setExporting(`${index + 1}/1`);
      const dataUrl = await captureSlide(el, size.w, size.h);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${String(index + 1).padStart(2, "0")}-${slides[index].id}-en-${size.w}x${size.h}.png`;
      a.click();
      setExporting(null);
    },
    [captureSlide, currentSizes, sizeIdx, slides]
  );

  const exportAll = useCallback(async () => {
    if (device === "feature-graphic") {
      await exportSingle(0);
      return;
    }
    const size = currentSizes[sizeIdx];
    for (let i = 0; i < slides.length; i++) {
      setExporting(`${i + 1}/${slides.length}`);
      const el = exportRefs.current[i];
      if (!el) continue;
      const dataUrl = await captureSlide(el, size.w, size.h);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${String(i + 1).padStart(2, "0")}-${slides[i].id}-en-${size.w}x${size.h}.png`;
      a.click();
      await new Promise((r) => setTimeout(r, 300));
    }
    setExporting(null);
  }, [device, currentSizes, sizeIdx, slides, captureSlide, exportSingle]);

  if (!ready) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontSize: 18,
          color: "#6b7280",
        }}
      >
        Loading images…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            overflowX: "auto",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: 14,
              whiteSpace: "nowrap",
              color: "#111",
            }}
          >
            ☕ Metic · Screenshots
          </span>

          <div
            style={{
              display: "flex",
              gap: 4,
              background: "#f3f4f6",
              borderRadius: 8,
              padding: 4,
              flexShrink: 0,
            }}
          >
            {(["iphone", "android", "feature-graphic"] as Device[]).map(
              (d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDevice(d);
                    setSizeIdx(0);
                  }}
                  style={{
                    padding: "4px 14px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    background: device === d ? "white" : "transparent",
                    color: device === d ? "#2563eb" : "#6b7280",
                    boxShadow:
                      device === d ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  {d === "iphone"
                    ? "iPhone"
                    : d === "android"
                      ? "Android"
                      : "Feature Graphic"}
                </button>
              )
            )}
          </div>

          {device !== "feature-graphic" && (
            <select
              value={sizeIdx}
              onChange={(e) => setSizeIdx(Number(e.target.value))}
              style={{
                fontSize: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: "5px 10px",
              }}
            >
              {currentSizes.map((s, i) => (
                <option key={i} value={i}>
                  {s.label} — {s.w}×{s.h}
                </option>
              ))}
            </select>
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: "10px 16px",
            borderLeft: "1px solid #e5e7eb",
          }}
        >
          <button
            onClick={exportAll}
            disabled={!!exporting}
            style={{
              padding: "7px 20px",
              background: exporting ? "#93c5fd" : "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: exporting ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {exporting ? `Exporting… ${exporting}` : "Export All"}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            device === "feature-graphic"
              ? "1fr"
              : "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 24,
          padding: 24,
          maxWidth: device === "feature-graphic" ? 900 : 1400,
          margin: "0 auto",
        }}
      >
        {slides.map((slide, i) => (
          <ScreenshotPreview
            key={`${device}-${slide.id}`}
            slide={slide}
            cW={cW}
            cH={cH}
            index={i}
            exportRef={(el) => {
              exportRefs.current[i] = el;
            }}
            onExportSingle={() => exportSingle(i)}
          />
        ))}
      </div>
    </div>
  );
}
