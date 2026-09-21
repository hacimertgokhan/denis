"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function ProfileForm({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      if (name !== user.name) {
        const r = await authClient.updateUser({ name });
        if (r.error) throw new Error(r.error.message);
      }
      if (next) {
        const r = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
        if (r.error) throw new Error(r.error.message);
        setCurrent("");
        setNext("");
      }
      toast.success("Saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="p-name">Name</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-current">Current password</Label>
          <Input id="p-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-next">New password</Label>
          <Input id="p-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} autoComplete="new-password" />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={() => void save()} disabled={busy || (name === user.name && !next)}>
          {busy && <Loader2Icon className="animate-spin" />} Save changes
        </Button>
      </CardFooter>
    </Card>
  );
}
