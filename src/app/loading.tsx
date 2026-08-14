import { LoadingPage } from "@/components/LoadingState";

export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <LoadingPage />
    </div>
  );
}
