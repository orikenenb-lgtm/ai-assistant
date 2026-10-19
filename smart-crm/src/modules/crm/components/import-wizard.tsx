"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import Papa from "papaparse";
import { CheckCircle2, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, Card, StatCard } from "@/components/ui/primitives";
import { Checkbox } from "@/components/ui/controls";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useServerAction } from "@/hooks/use-server-action";
import { importContactsAction } from "../contacts/actions";
import type { ImportReport } from "../contacts/import-export";

const FIELDS = ["firstName", "lastName", "fullName", "email", "phone", "title", "source", "lifecycleStage", "companyName", "tags"] as const;

/** Guesses a field from a column header (Hebrew and English). */
function guess(header: string): string {
  const h = header.toLowerCase().trim();
  const rules: [RegExp, string][] = [
    [/^(full ?name|name|שם מלא|שם)$/, "fullName"],
    [/(first|פרטי)/, "firstName"],
    [/(last|surname|משפחה)/, "lastName"],
    [/(mail|מייל|דוא)/, "email"],
    [/(phone|mobile|tel|טלפון|נייד|פלאפון)/, "phone"],
    [/(company|organization|חברה|ארגון|עסק)/, "companyName"],
    [/(title|role|תפקיד)/, "title"],
    [/(source|מקור)/, "source"],
    [/(stage|status|שלב|סטטוס)/, "lifecycleStage"],
    [/(tag|תגי)/, "tags"],
  ];
  return rules.find(([re]) => re.test(h))?.[1] ?? "ignore";
}

export function ImportWizard({ customFields }: { customFields: { key: string; label: string }[] }) {
  const t = useTranslations("import");
  const tc = useTranslations("common");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "update">("skip");
  const [createCompanies, setCreateCompanies] = useState(true);
  const [consentOptIn, setConsentOptIn] = useState(false);
  const [consentEvidence, setConsentEvidence] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const { run, pending, error } = useServerAction(importContactsAction);

  const preview = useMemo(() => {
    if (!csv) return null;
    const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", preview: 6, transformHeader: (h) => h.trim() });
    return { headers: parsed.meta.fields ?? [], rows: parsed.data };
  }, [csv]);

  const onFile = async (file: File) => {
    if (file.size > 2_000_000) {
      setCsv(null);
      return void alert(t("tooLarge"));
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setReport(null);
    const headers = Papa.parse(text.replace(/^﻿/, ""), { header: true, preview: 1, transformHeader: (h: string) => h.trim() }).meta.fields ?? [];
    setMapping(Object.fromEntries(headers.map((h) => [h, guess(h)])));
  };

  if (report) {
    return (
      <div className="space-y-6">
        <Alert tone="success" title={t("doneTitle")}>
          {t("doneBody", { file: fileName })}
        </Alert>
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label={t("rows")} value={report.total} />
          <StatCard label={t("created")} value={report.created} />
          <StatCard label={t("updated")} value={report.updated} />
          <StatCard label={t("skipped")} value={report.skipped} />
        </div>
        {report.errors.length > 0 && (
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">{t("errorsTitle", { count: report.errors.length })}</h3>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {report.errors.map((e) => (
                <li key={e.row}>
                  {t("rowError", { row: e.row })}: <span dir="auto">{e.message}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/contacts">{t("toContacts")}</Link>
          </Button>
          <Button variant="secondary" onClick={() => (setCsv(null), setReport(null))}>
            {t("another")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="font-semibold">1. {t("step1")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("step1Help")}</p>
        <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm hover:bg-accent/40">
          <FileUp className="size-6 text-muted-foreground" />
          <span className="font-medium">{fileName || t("chooseCsv")}</span>
          <span className="text-xs text-muted-foreground">{t("limits")}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} data-testid="csv-input" />
        </label>
      </Card>

      {preview && (
        <Card className="p-6">
          <h2 className="font-semibold">2. {t("step2")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("step2Help")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {preview.headers.map((h) => (
              <Field key={h} label={h} htmlFor={`map-${h}`}>
                <NativeSelect id={`map-${h}`} value={mapping[h] ?? "ignore"} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}>
                  <option value="ignore">{t("ignore")}</option>
                  {FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`fields.${f}`)}
                    </option>
                  ))}
                  {customFields.map((cf) => (
                    <option key={cf.key} value={`custom:${cf.key}`}>
                      {cf.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ))}
          </div>
          <h3 className="mb-2 mt-6 text-sm font-medium">{t("preview")}</h3>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {preview.headers.map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {preview.rows.map((r, i) => (
                <TR key={i}>
                  {preview.headers.map((h) => (
                    <TD key={h} className="max-w-48 truncate" dir="auto">
                      {r[h]}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {preview && (
        <Card className="space-y-4 p-6">
          <h2 className="font-semibold">3. {t("step3")}</h2>
          <Field label={t("duplicates")} htmlFor="dup">
            <NativeSelect id="dup" value={duplicateStrategy} onChange={(e) => setDuplicateStrategy(e.target.value as "skip" | "update")}>
              <option value="skip">{t("dupSkip")}</option>
              <option value="update">{t("dupUpdate")}</option>
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={createCompanies} onCheckedChange={(v) => setCreateCompanies(v === true)} /> {t("createCompanies")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={consentOptIn} onCheckedChange={(v) => setConsentOptIn(v === true)} /> {t("consentOptIn")}
          </label>
          {consentOptIn && (
            <Field label={t("consentEvidence")} htmlFor="evidence" hint={t("consentEvidenceHint")} error={error?.fieldErrors?.consentEvidence}>
              <Input id="evidence" value={consentEvidence} onChange={(e) => setConsentEvidence(e.target.value)} dir="auto" />
            </Field>
          )}
          {error && !error.fieldErrors && <Alert tone="danger">{error.message}</Alert>}
          <Button
            size="lg"
            loading={pending}
            onClick={async () => {
              const res = await run({ csv, mapping, duplicateStrategy, createCompanies, consentOptIn, consentEvidence: consentEvidence || undefined });
              if (res.ok) setReport(res.data);
            }}
          >
            <CheckCircle2 /> {t("run")}
          </Button>
          <p className="text-xs text-muted-foreground">{tc("optional")}: {t("note")}</p>
        </Card>
      )}
    </div>
  );
}
