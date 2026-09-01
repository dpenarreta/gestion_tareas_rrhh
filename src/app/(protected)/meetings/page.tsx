import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canCreateMeetings } from "@/lib/roles";
import { fetchDjangoCurrentUserId } from "@/lib/djangoTasksAdapter";
import MeetingsModule from "@/components/meetings/MeetingsModule";

export default async function MeetingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const djangoUserId = await fetchDjangoCurrentUserId();

  return (
    <MeetingsModule
      currentUserId={djangoUserId ?? String(session.djangoUserId)}
      canCreate={canCreateMeetings(session.role)}
    />
  );
}
