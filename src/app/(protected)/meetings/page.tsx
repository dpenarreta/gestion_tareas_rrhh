import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canCreateMeetings } from "@/lib/roles";
import MeetingsModule from "@/components/meetings/MeetingsModule";

export default async function MeetingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <MeetingsModule
      currentUserId={session.userId}
      canCreate={canCreateMeetings(session.role)}
    />
  );
}
