import { DiagramWorkspace } from "@/components/DiagramWorkspace";

type Props = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function DashboardGraphPage({ params }: Props) {
  const { owner, repo } = await params;
  return (
    <DiagramWorkspace
      owner={decodeURIComponent(owner)}
      repo={decodeURIComponent(repo)}
      embedded
    />
  );
}
