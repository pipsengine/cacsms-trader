import { StrategyPageRouter } from '@/components/strategies/strategy-page-router';

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ group: string; strategy: string }>;
}) {
  const { group, strategy } = await params;
  return <StrategyPageRouter group={group} strategy={strategy} />;
}
