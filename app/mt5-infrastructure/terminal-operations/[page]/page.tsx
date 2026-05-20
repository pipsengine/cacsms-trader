import { TerminalOperationsClientPage } from '@/components/terminal-operations-page';

export default async function TerminalOperationsPage(props: { params: Promise<{ page: string }> }) {
  const params = await props.params;
  return <TerminalOperationsClientPage page={params.page} />;
}

