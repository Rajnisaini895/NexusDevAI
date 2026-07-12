import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string }>;
}) {
  const cookieStore = await cookies();
  const { github } = await searchParams;

  if (
    !cookieStore.has("nexus_access_token") &&
    !cookieStore.has("nexus_refresh_token")
  ) {
    redirect("/");
  }

  return <DashboardClient githubStatus={github} />;
}
