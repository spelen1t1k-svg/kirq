import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MyProfile() {
  const user = await getUser();
  if (!user) redirect("/login");
  redirect(`/profile/${user.id}`);
}
