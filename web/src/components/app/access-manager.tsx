"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, CopyIcon, KeyRoundIcon, Loader2Icon, MoreHorizontalIcon, RefreshCwIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SectionRow } from "@/components/app/page-primitives";
import { apiFetch } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MemberRow = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
};
export type AccountRow = {
  id: string;
  username: string;
  role: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
};

const ROLES = ["owner", "admin", "editor", "viewer"];

const ROLE_HELP: Record<string, string> = {
  admin: "Read, write, manage keys and access",
  editor: "Read and write data",
  viewer: "Read only",
};

/** Rows of the permission matrix, in the order they are shown. */
const CAPABILITIES: [string, Record<string, boolean>][] = [
  ["Read data", { owner: true, admin: true, editor: true, viewer: true }],
  ["Write data", { owner: true, admin: true, editor: true, viewer: false }],
  ["View history", { owner: true, admin: true, editor: true, viewer: true }],
  ["API keys", { owner: true, admin: true, editor: false, viewer: false }],
  ["Members and accounts", { owner: true, admin: true, editor: false, viewer: false }],
  ["Rename, empty", { owner: true, admin: true, editor: false, viewer: false }],
  ["Delete database", { owner: true, admin: false, editor: false, viewer: false }],
];

function RoleSelect({ value, onChange, id, className }: { value: string; onChange: (v: string) => void; id?: string; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={cn("h-8 w-28 capitalize", className)}>
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {Object.entries(ROLE_HELP).map(([role, help]) => (
          <SelectItem key={role} value={role} className="capitalize">
            <span>{role}</span>
            <span className="text-muted-foreground ml-1 text-[12px] normal-case">{help}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Initials({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn("bg-muted text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[11.5px] font-medium", className)}
    >
      {initials || "?"}
    </span>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-muted/40 flex items-center gap-2 rounded-md border pr-1 pl-3">
      <span className="text-muted-foreground min-w-0 flex-1 truncate py-2 font-mono text-[12.5px]">{value}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-[12px]"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function randomPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function AccessManager({
  databaseId,
  owner,
  members,
  accounts,
  loginUrl,
  canManage,
}: {
  databaseId: string;
  owner: { name: string; email: string };
  members: MemberRow[];
  accounts: AccountRow[];
  loginUrl: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [memberRole, setMemberRole] = useState("viewer");
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accountRole, setAccountRole] = useState("editor");
  const [creating, setCreating] = useState(false);
  // Shown once after creating an account or resetting a password.
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  async function addMember() {
    setAdding(true);
    try {
      await apiFetch(`/api/v1/databases/${databaseId}/members`, {
        method: "POST",
        body: JSON.stringify({ email, role: memberRole }),
      });
      toast.success(`${email} added as ${memberRole}`);
      setEmail("");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function createAccount() {
    setCreating(true);
    try {
      await apiFetch(`/api/v1/databases/${databaseId}/accounts`, {
        method: "POST",
        body: JSON.stringify({ username, password, role: accountRole }),
      });
      setIssued({ username: username.trim().toLowerCase(), password });
      setUsername("");
      setPassword("");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function patchAccount(id: string, patch: Record<string, unknown>, message: string) {
    try {
      await apiFetch(`/api/v1/databases/${databaseId}/accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.success(message);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const rowClass = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3";

  return (
    <div>
      <SectionRow title="Roles" description="The same four roles apply to members, database accounts and API keys.">
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-[12px]">
                <th className="px-4 py-2.5 font-medium">Can</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center font-medium capitalize">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map(([label, roles]) => (
                <tr key={label} className="border-b last:border-b-0">
                  <td className="px-4 py-2">{label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2 text-center">
                      {roles[r] ? <CheckIcon className="mx-auto size-3.5 text-[var(--chart-1)]" /> : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionRow>

      <SectionRow title="Members" description="People with a platform account. They see this database next to their own and use their usual sign-in.">
        <div className="bg-card overflow-hidden rounded-lg border">
          <ul className="divide-y text-[13.5px]">
            <li className={rowClass}>
              <div className="flex min-w-0 items-center gap-3">
                <Initials name={owner.name} className="bg-foreground text-background" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{owner.name}</div>
                  <div className="text-muted-foreground truncate text-[12.5px]">{owner.email}</div>
                </div>
              </div>
              <Badge variant="outline" className="capitalize">
                owner
              </Badge>
            </li>
            {members.map((m) => (
              <li key={m.id} className={rowClass}>
                <div className="flex min-w-0 items-center gap-3">
                  <Initials name={m.name} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.name}</div>
                    <div className="text-muted-foreground truncate text-[12.5px]">
                      {m.email} · added {relativeTime(m.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {canManage ? (
                    <RoleSelect
                      value={m.role}
                      onChange={async (role) => {
                        try {
                          await apiFetch(`/api/v1/databases/${databaseId}/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role }) });
                          toast.success(`${m.name} is now ${role}`);
                          router.refresh();
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                    />
                  ) : (
                    <Badge variant="secondary" className="capitalize">
                      {m.role}
                    </Badge>
                  )}
                  {canManage && (
                    <ConfirmDialog
                      title={`Remove ${m.name}?`}
                      description="They lose access to this database immediately."
                      confirmLabel="Remove member"
                      onConfirm={async () => {
                        await apiFetch(`/api/v1/databases/${databaseId}/members/${m.id}`, { method: "DELETE" });
                        toast.success("Member removed");
                        router.refresh();
                      }}
                      trigger={
                        <Button variant="ghost" size="sm" className="text-muted-foreground h-8">
                          Remove
                        </Button>
                      }
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {canManage && (
            <form
              className="bg-muted/30 flex flex-wrap items-end gap-2 border-t px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void addMember();
              }}
            >
              <div className="grid min-w-56 flex-1 gap-1.5">
                <Label htmlFor="m-email" className="text-[12px]">
                  Email of a registered user
                </Label>
                <Input
                  id="m-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  required
                  className="bg-background h-8"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="m-role" className="text-[12px]">
                  Role
                </Label>
                <RoleSelect id="m-role" value={memberRole} onChange={setMemberRole} className="bg-background" />
              </div>
              <Button type="submit" size="sm" variant="outline" className="h-8" disabled={adding || !email}>
                {adding ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />} Add member
              </Button>
            </form>
          )}
        </div>
      </SectionRow>

      <SectionRow
        title="Database accounts"
        description="Usernames for this database only. They sign in at the database's own page, never see the platform, and every command they run is recorded under their name."
      >
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-[12px]">Login page</Label>
            <CopyField value={loginUrl} />
          </div>

          {issued && (
            <div className="rounded-lg border border-[var(--chart-1)]/40 bg-[var(--chart-1)]/5 px-4 py-3 text-[13.5px]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium">
                    Credentials for <span className="font-mono">{issued.username}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-[12.5px]">Shown once. Copy the password now; it cannot be recovered later.</p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setIssued(null)}>
                  Done
                </Button>
              </div>
              <div className="mt-3">
                <CopyField value={issued.password} />
              </div>
            </div>
          )}

          <div className="bg-card overflow-hidden rounded-lg border">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-[12px]">
                  <th className="px-4 py-2.5 font-medium">Username</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="hidden px-3 py-2.5 font-medium @2xl/main:table-cell">Last sign-in</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                      No accounts yet. Create one below and hand out the login page.
                    </td>
                  </tr>
                )}
                {accounts.map((a) => (
                  <tr key={a.id} className={cn("border-b last:border-b-0", a.disabledAt && "text-muted-foreground")}>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2 font-mono">
                        <KeyRoundIcon className="text-muted-foreground size-3.5" />
                        {a.username}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <RoleSelect value={a.role} onChange={(role) => void patchAccount(a.id, { role }, `${a.username} is now ${role}`)} />
                      ) : (
                        <span className="capitalize">{a.role}</span>
                      )}
                    </td>
                    <td className="text-muted-foreground hidden px-3 py-2 text-[13px] @2xl/main:table-cell">
                      {a.lastLoginAt ? relativeTime(a.lastLoginAt) : "never"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px]">
                        <span className={cn("size-1.5 rounded-full", a.disabledAt ? "bg-muted-foreground/40" : "bg-[var(--chart-1)]")} />
                        {a.disabledAt ? "Disabled" : "Active"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7" aria-label="Account actions">
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={async () => {
                                const next = randomPassword();
                                await patchAccount(a.id, { password: next }, `Password reset for ${a.username}`);
                                setIssued({ username: a.username, password: next });
                              }}
                            >
                              <RefreshCwIcon /> Reset password
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void patchAccount(a.id, { disabled: !a.disabledAt }, a.disabledAt ? "Account enabled" : "Account disabled")}
                            >
                              {a.disabledAt ? "Enable" : "Disable"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={async () => {
                                await apiFetch(`/api/v1/databases/${databaseId}/accounts/${a.id}`, { method: "DELETE" });
                                toast.success(`Deleted ${a.username}`);
                                router.refresh();
                              }}
                            >
                              Delete account
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage && (
              <form
                className="bg-muted/30 flex flex-wrap items-end gap-2 border-t px-4 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createAccount();
                }}
              >
                <div className="grid min-w-40 flex-1 gap-1.5">
                  <Label htmlFor="a-user" className="text-[12px]">
                    Username
                  </Label>
                  <Input
                    id="a-user"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="reporting"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    className="bg-background h-8 font-mono"
                  />
                </div>
                <div className="grid min-w-52 flex-1 gap-1.5">
                  <Label htmlFor="a-pass" className="text-[12px]">
                    Password
                  </Label>
                  <div className="flex gap-1">
                    <Input
                      id="a-pass"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="at least 8 characters"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="bg-background h-8 font-mono"
                    />
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[12px]" onClick={() => setPassword(randomPassword())}>
                      Generate
                    </Button>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="a-role" className="text-[12px]">
                    Role
                  </Label>
                  <RoleSelect id="a-role" value={accountRole} onChange={setAccountRole} className="bg-background" />
                </div>
                <Button type="submit" size="sm" variant="outline" className="h-8" disabled={creating || !username || password.length < 8}>
                  {creating ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />} Create account
                </Button>
              </form>
            )}
          </div>
        </div>
      </SectionRow>
    </div>
  );
}
