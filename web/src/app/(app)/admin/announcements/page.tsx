import { AdminAnnounce } from "@/components/app/admin-announce";
import { PageHeader } from "@/components/app/page-primitives";
import { announcementAudience } from "@/lib/announcements";
import { mailConfigured } from "@/lib/mail";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Announcements" };

export default async function AdminAnnouncementsPage() {
  const me = await requireAdmin();
  const audience = await announcementAudience();
  return (
    <>
      <PageHeader
        title="Announcements"
        description="A product update by email to everyone who asked for one. Plain text, one column, an unsubscribe link in every copy."
      />
      <AdminAnnounce recipients={audience.length} mailConfigured={mailConfigured()} adminEmail={me.email} />
    </>
  );
}
