import { notFound } from 'next/navigation';

import { StrategyControlDashboard } from '@/components/strategies/strategy-control-dashboard';
import { isStrategyControlSlug } from '@/lib/strategies/strategy-control-modules';

export default async function StrategyControlPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  if (!isStrategyControlSlug(module)) {
    notFound();
  }
  return <StrategyControlDashboard moduleId={module} />;
}
