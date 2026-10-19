"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { MailPlus, MoreHorizontal, RotateCw, UserMinus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  setMemberStatusAction,
} from "@/modules/org/member-actions";

type Role = "owner" | "manager" | "agent";
type Member = { userId: string; fullName: string; email: string; role: Role; status: "active" | "disabled"; joinedAt: Date };
type Invitation = { id: string; email: string; role: Role; expiresAt: Date; createdAt: Date; invitedByName: string | null };

const ROLES: Role[] = ["owner", "manager", "agent"];

function canManage(actor: Role | null, target: Role) {
  if (actor === "owner") return true;
  return actor === "manager" && target === "agent";
}

function assignable(actor: Role | null): Role[] {
  if (actor === "owner") return ROLES;
  if (actor === "manager") return ["agent"];
  return [];
}

export function TeamManager({
  members,
  invitations,
  currentUserId,
  actorRole,
  canInvite,
  canManageMembers,
  seats,
}: {
  members: Member[];
  invitations: Invitation[];
  currentUserId: string;
  actorRole: Role | null;
  canInvite: boolean;
  canManageMembers: boolean;
  seats: { used: number; limit: number | null };
}) {
  const t = useTranslations("members");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [busy, start] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error?.message ?? tc("retry"));
      toast.success(success);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="seat-usage">
              {seats.limit === null ? t("seatUsageUnlimited", { used: seats.used }) : t("seatUsage", { used: seats.used, limit: seats.limit })}
            </p>
          </div>
          {canInvite && <InviteDialog roles={assignable(actorRole)} onDone={() => router.refresh()} />}
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t("member")}</TH>
                <TH>{t("role")}</TH>
                <TH className="hidden sm:table-cell">{t("status")}</TH>
                <TH className="hidden md:table-cell">{t("joined")}</TH>
                <TH className="w-12">
                  <span className="sr-only">{t("actions")}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {members.map((m) => {
                const self = m.userId === currentUserId;
                const manageable = canManageMembers && !self && canManage(actorRole, m.role);
                return (
                  <TR key={m.userId} data-testid="member-row">
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.fullName || m.email} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {m.fullName || m.email} {self && <span className="text-xs font-normal text-muted-foreground">{t("you")}</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground" dir="ltr">
                            {m.email}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={m.role === "owner" ? "ai" : m.role === "manager" ? "primary" : "neutral"}>{t(`roles.${m.role}`)}</Badge>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Badge tone={m.status === "active" ? "success" : "warning"}>{m.status === "active" ? t("active") : t("disabled")}</Badge>
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">{formatDate(m.joinedAt, locale)}</TD>
                    <TD>
                      {manageable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`${t("actions")}: ${m.fullName || m.email}`} disabled={busy}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuLabel>{t("changeRole")}</DropdownMenuLabel>
                            {assignable(actorRole)
                              .filter((r) => r !== m.role)
                              .map((r) => (
                                <DropdownMenuItem key={r} onSelect={() => act(() => changeMemberRoleAction({ userId: m.userId, role: r }), t("roleChanged"))}>
                                  {t(`roles.${r}`)}
                                </DropdownMenuItem>
                              ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                act(() => setMemberStatusAction({ userId: m.userId, status: m.status === "active" ? "disabled" : "active" }), tc("saved"))
                              }
                            >
                              {m.status === "active" ? t("disable") : t("enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="danger" onSelect={() => act(() => removeMemberAction({ userId: m.userId }), t("removed"))}>
                              <UserMinus /> {t("remove")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {(canInvite || invitations.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("pending")}</CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("pendingEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="invitation-row">
                    <MailPlus className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium" dir="ltr">
                      {inv.email}
                    </span>
                    <Badge tone="primary">{t(`roles.${inv.role}`)}</Badge>
                    <span className="text-xs text-muted-foreground">{t("expires", { date: formatDate(inv.expiresAt, locale) })}</span>
                    {canInvite && (
                      <span className="flex gap-1">
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => resendInvitationAction({ id: inv.id }), t("resent"))}>
                          <RotateCw /> {t("resend")}
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button variant="danger-ghost" size="sm" disabled={busy}>
                              <X /> {t("revoke")}
                            </Button>
                          }
                          confirmLabel={t("revoke")}
                          onConfirm={() => act(() => revokeInvitationAction({ id: inv.id }), t("revoked"))}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InviteDialog({ roles, onDone }: { roles: Role[]; onDone: () => void }) {
  const t = useTranslations("members");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(roles.includes("agent") ? "agent" : roles[0]);
  const { run, pending, fieldErrors, error } = useServerAction(inviteMemberAction, { successMessage: t("invited") });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <MailPlus /> {t("invite")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("inviteTitle")}</DialogTitle>
          <DialogDescription>{t("inviteHelp")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run({ ...formToObject(e.currentTarget), role });
            if (res.ok) {
              setOpen(false);
              onDone();
            }
          }}
        >
          <Field label={t("inviteEmail")} htmlFor="invite-email" error={fieldErrors.email} required>
            <Input id="invite-email" name="email" type="email" dir="ltr" required autoFocus />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{t("role")}</legend>
            {roles.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors",
                  role === r && "border-primary bg-primary-soft/40",
                )}
              >
                <input type="radio" name="role-choice" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[var(--primary)]" />
                <span>
                  <span className="block text-sm font-medium">{t(`roles.${r}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`roleDescriptions.${r}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error && !error.fieldErrors && <p className="text-sm text-danger-foreground">{error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("sendInvite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
