import { DiagramWorkspace } from "@/components/DiagramWorkspace";

type Props = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoGraphPage({ params }: Props) {
  const { owner, repo } = await params;
  return <DiagramWorkspace owner={owner} repo={repo} />;
}
