import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";
import DeskBoard from "@/components/desk/DeskBoard";

export default async function DeskPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canUseDeskNotes(session.role)) notFound();

  return <DeskBoard />;
}
