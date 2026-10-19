import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Globe, Mail, MapPin, Phone } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { getCompany } from "@/modules/crm/companies/service";
import { CompanyFormDialog } from "@/modules/crm/companies/components/company-form-dialog";
import { CompanyDeleteButton, CompanyTagsEditor } from "@/modules/crm/companies/components/company-detail";
import { DetailRow, RecordTabs, formatCustomValue } from "@/modules/sales/components/shared";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tc = await requireTenant();
  try {
    return { tc, data: await getCompany(tc.ctx, id) };
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const { data } = await load(id);
  return { title: data.company.name };
}

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const { tc, data } = await load(id);
  const { ctx, user } = tc;
  const { company: c, owner, tags, customFieldDefs, contacts, deals } = data;
  const t = await getTranslations("companies");
  const tcm = await getTranslations("common");
  const td = await getTranslations("deals");
  const locale = (await getLocale()) as "he" | "en";
  const [allTags, members] = await Promise.all([listTags(ctx), listAssignableMembers(ctx)]);
  const canEdit = ctx.can("companies.update") && !ctx.readOnly;

  const contactsTab = contacts.length ? (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {contacts.map((p) => {
        const name = `${p.firstName} ${p.lastName}`.trim() || p.email || p.phone || "—";
        return (
          <li key={p.id}>
            <Link href={`/contacts/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
              <Avatar name={name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground" dir="auto">
                  {[p.title, p.email].filter(Boolean).join(" · ")}
                </span>
              </span>
              {p.phone && (
                <span className="text-sm text-muted-foreground" dir="ltr">
                  {formatPhone(p.phone)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="py-6 text-center text-sm text-muted-foreground">{t("noContacts")}</p>
  );

  const dealsTab = (
    <>
      {deals.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("noDeals")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {deals.map((d) => (
            <li key={d.id}>
              <Link href={`/deals/${d.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
                <span className="font-medium">{d.title}</span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "primary"}>{d.stage}</Badge>
                  <span className="tabular">{formatMoney(d.valueCents, d.currency, locale)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {ctx.can("deals.create") && !ctx.readOnly && (
        <Button asChild variant="link" className="mt-3">
          <Link href={`/deals?new=1&company=${c.id}`}>{t("newDeal")}</Link>
        </Button>
      )}
    </>
  );

  const breadcrumbLabel = (await getTranslations("common"))("breadcrumb");
  return (
    <div className="space-y-6">
      <nav aria-label={breadcrumbLabel} className="text-sm text-muted-foreground">
        <Link href="/companies" className="hover:text-foreground">
          {t("title")}
        </Link>{" "}
        / <span className="text-foreground">{c.name}</span>
      </nav>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={c.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight" dir="auto">
              {c.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {c.industry && <span dir="auto">{c.industry}</span>}
              {c.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" /> {c.city}
                </span>
              )}
              <Badge tone="neutral">
                {t("contactsCount")}: {contacts.length}
              </Badge>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <CompanyFormDialog
                members={members}
                tags={allTags}
                customFieldDefs={customFieldDefs}
                trigger={
                  <Button variant="secondary" size="sm">
                    {tcm("edit")}
                  </Button>
                }
                initial={{
                  id: c.id,
                  name: c.name,
                  domain: c.domain,
                  industry: c.industry,
                  sizeRange: c.sizeRange,
                  phone: c.phone,
                  email: c.email,
                  website: c.website,
                  address: c.address,
                  city: c.city,
                  country: c.country,
                  ownerId: c.ownerId,
                  customFields: c.customFields,
                  tagIds: tags.map((x) => x.id),
                }}
              />
            )}
            {ctx.can("companies.delete") && !ctx.readOnly && <CompanyDeleteButton companyId={c.id} name={c.name} />}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <DetailRow icon={<Phone className="size-4" />} label={tcm("phone")}>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} dir="ltr" className="hover:underline">
                      {formatPhone(c.phone)}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow icon={<Mail className="size-4" />} label={tcm("email")}>
                  {c.email ? (
                    <a href={`mailto:${c.email}`} dir="ltr" className="break-all hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow icon={<Globe className="size-4" />} label={t("website")}>
                  {c.website ? (
                    <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="break-all hover:underline">
                      {c.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label={t("domain")}>{c.domain ?? "—"}</DetailRow>
                <DetailRow label={t("size")}>{c.sizeRange ? t(`sizes.${c.sizeRange}` as "sizes.1-10") : "—"}</DetailRow>
                <DetailRow label={t("address")}>{[c.address, c.city, c.country].filter(Boolean).join(", ") || "—"}</DetailRow>
                <DetailRow label={tcm("owner")}>{owner?.fullName ?? tcm("unassigned")}</DetailRow>
                <DetailRow label={tcm("createdAt")}>{formatDate(c.createdAt, locale)}</DetailRow>
                {customFieldDefs.map((d) => (
                  <DetailRow key={d.id} label={d.label}>
                    {formatCustomValue(c.customFields[d.key], tcm("yes"), tcm("no"))}
                  </DetailRow>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tcm("tags")}</CardTitle>
            </CardHeader>
            <CardContent>
              <CompanyTagsEditor companyId={c.id} allTags={allTags} initial={tags.map((x) => x.id)} canEdit={canEdit} />
            </CardContent>
          </Card>
        </div>

        <RecordTabs
          kind="company"
          entityId={c.id}
          currentUserId={user.userId}
          canEdit={canEdit}
          canModerate={ctx.role === "owner" || ctx.role === "manager"}
          extraTabs={[
            { value: "contacts", label: `${t("contactsCount")} (${contacts.length})`, content: contactsTab },
            { value: "deals", label: `${td("title")} (${deals.length})`, content: dealsTab },
          ]}
        />
      </div>
    </div>
  );
}
