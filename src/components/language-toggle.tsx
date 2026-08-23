'use client';

import { useI18n } from '@/components/i18n';
import { Button } from '@/components/ui/button';
import { Languages } from 'lucide-react';

export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
      title="Switch language / 切换语言"
    >
      <Languages className="h-3.5 w-3.5" />
      {lang === 'en' ? 'EN' : '中文'}
    </Button>
  );
}
