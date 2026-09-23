"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionRow } from "@/components/app/page-primitives";
import { authClient } from "@/lib/auth-client";

export function ProfileForm({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [savingName, setSavingName] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function saveName() {
    setSavingName(true);
    try {
      const r = await authClient.updateUser({ name: name.trim() });
      if (r.error) throw new Error(r.error.message);
      toast.success("Name saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword() {
    setSavingPassword(true);
    try {
      const r = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (r.error) throw new Error(r.error.message);
      setCurrent("");
      setNext("");
      toast.success("Password changed. Other sessions were signed out.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <>
      <SectionRow title="Name" description="Shown in the sidebar and in activity.">
        <form
          className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="p-name">Full name</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={savingName || !name.trim() || name.trim() === user.name}>
            {savingName && <Loader2Icon className="animate-spin" />} Save name
          </Button>
        </form>
      </SectionRow>

      <SectionRow title="Email" description="Used to sign in. Contact support to change it.">
        <p className="text-[14px]">{user.email}</p>
      </SectionRow>

      <SectionRow title="Password" description="At least 8 characters. Changing it signs out your other sessions.">
        <form
          className="grid max-w-md gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void savePassword();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="p-current">Current password</Label>
            <Input id="p-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-next">New password</Label>
            <Input id="p-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} autoComplete="new-password" />
          </div>
          <div>
            <Button type="submit" variant="outline" disabled={savingPassword || !current || next.length < 8}>
              {savingPassword && <Loader2Icon className="animate-spin" />} Change password
            </Button>
          </div>
        </form>
      </SectionRow>
    </>
  );
}
