import { redirect } from "next/navigation";

export default function DashboardBrowseRedirect() {
  redirect("/dashboard/query");
}
