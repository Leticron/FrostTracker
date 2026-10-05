import { useTranslation } from 'react-i18next';
import { Card, PageTitle } from './ui.tsx';

export function Placeholder({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <Card>
        <p className="text-slate-600 dark:text-slate-400">{t('common.comingSoon')}</p>
      </Card>
    </>
  );
}
