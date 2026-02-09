import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe } from '@phosphor-icons/react';
import { supportedLanguages, languageNames, type SupportedLanguage } from '@/i18n/config';

interface LanguageSelectorProps {
  variant?: 'default' | 'ghost' | 'outline';
  showLabel?: boolean;
}

export function LanguageSelector({ variant = 'ghost', showLabel = true }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation();

  const changeLanguage = (lng: SupportedLanguage) => {
    i18n.changeLanguage(lng);
  };

  const currentLanguage = i18n.language as SupportedLanguage;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant={variant} 
          size="sm" 
          className="gap-2"
          aria-label={t('settings.language.select')}
        >
          <Globe size={18} weight="bold" aria-hidden="true" />
          {showLabel && <span>{languageNames[currentLanguage]}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {supportedLanguages.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onClick={() => changeLanguage(lang)}
            className={currentLanguage === lang ? 'bg-accent' : ''}
          >
            <span className="flex items-center justify-between w-full">
              <span>{languageNames[lang]}</span>
              {currentLanguage === lang && (
                <span className="ml-2 text-primary" aria-label={t('common.selected')}>✓</span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
