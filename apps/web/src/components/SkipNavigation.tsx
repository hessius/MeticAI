import type React from 'react';
import { useTranslation } from 'react-i18next';

interface SkipNavigationProps {
  links?: Array<{
    id: string;
    label: string;
  }>;
}

/**
 * Skip Navigation component for keyboard accessibility
 * Allows users to skip repetitive navigation and jump to main content
 */
const FOCUS_CLEANUP_DELAY = 100; // milliseconds

export function SkipNavigation({ links }: SkipNavigationProps) {
  const { t } = useTranslation();
  const defaultLinks = [
    { id: 'main-content', label: t('a11y.skipToMain') },
    { id: 'navigation', label: t('a11y.skipToNav') },
  ];

  const skipLinks = links || defaultLinks;

  const handleSkipClick = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
      // Set tabindex to make it focusable
      if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
      }
      target.focus();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      // Remove tabindex after focus to restore natural tab order
      setTimeout(() => {
        if (target.getAttribute('tabindex') === '-1') {
          target.removeAttribute('tabindex');
        }
      }, FOCUS_CLEANUP_DELAY);
    }
  };

  return (
    <div className="skip-navigation" aria-label="Skip navigation links">
      {skipLinks.map((link) => (
        <a
          key={link.id}
          href={`#${link.id}`}
          className="skip-link"
          onClick={(e) => handleSkipClick(e, link.id)}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
