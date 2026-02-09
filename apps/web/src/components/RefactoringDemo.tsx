import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '@/components/LanguageSelector';
import { SkipNavigation } from '@/components/SkipNavigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useReducedMotion, useScreenReaderAnnouncement } from '@/hooks/a11y/useScreenReader';
import { Coffee, Sparkles, Globe, AccessibilityIcon } from 'lucide-react';

/**
 * Demonstration page showcasing the comprehensive refactoring improvements:
 * - Multi-language support (i18n)
 * - Accessibility features
 * - Type safety
 * - New service architecture
 */
export function RefactoringDemo() {
  const { t, i18n } = useTranslation();
  const announce = useScreenReaderAnnouncement();
  const prefersReducedMotion = useReducedMotion();

  const handleAnnouncement = () => {
    announce(t('common.success_message') || 'Action successful!', 'polite');
  };

  const features = [
    {
      icon: Globe,
      title: t('demo.features.i18n.title') || 'Multi-Language Support',
      description: t('demo.features.i18n.description') || 'Full internationalization with 6 languages: English, Swedish, Spanish, Italian, French, and German.',
      color: 'text-blue-500',
    },
    {
      icon: AccessibilityIcon,
      title: t('demo.features.accessibility.title') || 'Accessibility (WCAG AA)',
      description: t('demo.features.accessibility.description') || 'Comprehensive accessibility features including keyboard navigation, screen reader support, focus management, and reduced motion support.',
      color: 'text-green-500',
    },
    {
      icon: Sparkles,
      title: t('demo.features.typescript.title') || 'Type Safety',
      description: t('demo.features.typescript.description') || 'Strict TypeScript mode with Zod schemas for runtime validation, centralized type definitions, and improved developer experience.',
      color: 'text-purple-500',
    },
    {
      icon: Coffee,
      title: t('demo.features.architecture.title') || 'Modern Architecture',
      description: t('demo.features.architecture.description') || 'Service layer architecture, utility functions, custom hooks, and modular components for better maintainability.',
      color: 'text-amber-500',
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SkipNavigation />
      
      {/* Header */}
      <header className="border-b border-border bg-card" role="banner">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Coffee className="w-8 h-8 text-primary" aria-hidden="true" />
            <span>{t('app.title') || 'MeticAI Espresso'}</span>
          </h1>
          
          <div className="flex items-center gap-4">
            <LanguageSelector />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" className="container mx-auto px-4 py-8" role="main">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Intro Section */}
          <section 
            className="text-center space-y-4"
            aria-labelledby="intro-heading"
          >
            <h2 id="intro-heading" className="text-4xl font-bold">
              {t('demo.title') || 'Comprehensive Codebase Overhaul'}
            </h2>
            <p className="text-xl text-muted-foreground">
              {t('demo.subtitle') || 'A modern, accessible, and maintainable espresso profile generator'}
            </p>
            
            {/* Language Indicator */}
            <div className="flex items-center justify-center gap-2">
              <Globe className="w-5 h-5" aria-hidden="true" />
              <span className="sr-only">{t('common.current_language') || 'Current language'}:</span>
              <Badge variant="secondary" className="text-sm">
                {i18n.language.toUpperCase()}
              </Badge>
              {prefersReducedMotion && (
                <Badge variant="outline" className="text-sm">
                  <AccessibilityIcon className="w-3 h-3 mr-1" aria-hidden="true" />
                  {t('demo.reduced_motion') || 'Reduced Motion'}
                </Badge>
              )}
            </div>
          </section>

          {/* Features Grid */}
          <section 
            aria-labelledby="features-heading"
            className="space-y-6"
          >
            <h2 id="features-heading" className="text-2xl font-bold text-center">
              {t('demo.features_title') || 'Key Improvements'}
            </h2>
            
            <div className="grid md:grid-cols-2 gap-6" role="list">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Card 
                    key={index}
                    className="p-6 space-y-3"
                    role="listitem"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-8 h-8 ${feature.color}`} aria-hidden="true" />
                      <h3 className="text-xl font-semibold">
                        {feature.title}
                      </h3>
                    </div>
                    <p className="text-muted-foreground">
                      {feature.description}
                    </p>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* Interactive Demo */}
          <section 
            aria-labelledby="demo-heading"
            className="space-y-4"
          >
            <h2 id="demo-heading" className="text-2xl font-bold text-center">
              {t('demo.interactive_title') || 'Try It Out'}
            </h2>
            
            <Card className="p-6 space-y-4">
              <p className="text-center text-muted-foreground">
                {t('demo.interactive_description') || 'Test the accessibility features'}
              </p>
              
              <div className="flex flex-wrap gap-3 justify-center">
                <Button
                  onClick={handleAnnouncement}
                  aria-label={t('demo.test_screen_reader') || 'Test screen reader announcement'}
                >
                  <Sparkles className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t('demo.announce_button') || 'Announce to Screen Reader'}
                </Button>
                
                <Button variant="outline">
                  <AccessibilityIcon className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t('demo.keyboard_nav') || 'Keyboard Navigation'}
                </Button>
              </div>

              {/* Accessibility Tips */}
              <div 
                className="mt-6 p-4 bg-muted rounded-lg"
                role="region"
                aria-label={t('demo.a11y_tips_label') || 'Accessibility tips'}
              >
                <h3 className="font-semibold mb-2">
                  {t('demo.a11y_tips_title') || 'Accessibility Features:'}
                </h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>• {t('demo.tips.keyboard') || 'Press Tab to navigate between elements'}</li>
                  <li>• {t('demo.tips.skip') || 'Press Shift+Tab to navigate backwards'}</li>
                  <li>• {t('demo.tips.screen_reader') || 'Screen readers announce all interactive elements'}</li>
                  <li>• {t('demo.tips.reduced_motion') || 'Animations respect prefers-reduced-motion setting'}</li>
                  <li>• {t('demo.tips.contrast') || 'WCAG AA color contrast compliance'}</li>
                </ul>
              </div>
            </Card>
          </section>

          {/* Technical Details */}
          <section 
            aria-labelledby="tech-heading"
            className="space-y-4"
          >
            <h2 id="tech-heading" className="text-2xl font-bold text-center">
              {t('demo.technical_title') || 'Technical Implementation'}
            </h2>
            
            <Card className="p-6">
              <dl className="space-y-4">
                <div>
                  <dt className="font-semibold">{t('demo.tech.i18n') || 'Internationalization'}:</dt>
                  <dd className="text-muted-foreground mt-1">
                    react-i18next with 302 translation keys across 6 languages
                  </dd>
                </div>
                
                <div>
                  <dt className="font-semibold">{t('demo.tech.types') || 'Type Safety'}:</dt>
                  <dd className="text-muted-foreground mt-1">
                    TypeScript strict mode + Zod schemas for runtime validation
                  </dd>
                </div>
                
                <div>
                  <dt className="font-semibold">{t('demo.tech.a11y') || 'Accessibility'}:</dt>
                  <dd className="text-muted-foreground mt-1">
                    WCAG AA compliant, keyboard navigation, screen reader support, focus management
                  </dd>
                </div>
                
                <div>
                  <dt className="font-semibold">{t('demo.tech.architecture') || 'Architecture'}:</dt>
                  <dd className="text-muted-foreground mt-1">
                    Service layer, utility functions, custom hooks, modular components
                  </dd>
                </div>
              </dl>
            </Card>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-6" role="contentinfo">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>{t('demo.footer') || 'MeticAI Espresso - Powered by AI, Built for Accessibility'}</p>
        </div>
      </footer>
    </div>
  );
}
