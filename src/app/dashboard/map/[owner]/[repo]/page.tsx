import { SystemMapView } from "@/components/systemmap/SystemMapView";

type Props = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function DashboardMapViewerPage({ params }: Props) {
  const { owner, repo } = await params;
  return (
    <SystemMapView owner={decodeURIComponent(owner)} repo={decodeURIComponent(repo)} />
  );
}
