import { PlatformUserDetailPage } from '@/components/platform-administration/platform-user-detail';

type PageProps = { params: Promise<{ id: string }> };

export default async function UserDetailRoute({ params }: PageProps) {
  const { id } = await params;
  return <PlatformUserDetailPage userId={id} />;
}
