import { redirect } from "next/navigation";
import { graphPath } from "@/lib/paths";

type Props = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoGraphRedirectPage({ params }: Props) {
  const { owner, repo } = await params;
  redirect(graphPath(owner, repo));
}
