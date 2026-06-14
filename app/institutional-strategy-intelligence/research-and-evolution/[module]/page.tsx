import { notFound } from 'next/navigation';

import { ResearchEvolutionDashboard } from '@/components/strategies/research-evolution-dashboard';
import { isResearchEvolutionSlug } from '@/lib/strategies/research-evolution-modules';

export default async function ResearchEvolutionPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  if (!isResearchEvolutionSlug(module)) {
    notFound();
  }
  return <ResearchEvolutionDashboard moduleId={module} />;
}
