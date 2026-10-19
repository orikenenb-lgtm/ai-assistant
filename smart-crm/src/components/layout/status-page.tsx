import Link from "next/link";
import { FileQuestion, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared body for not-found and error pages (inside or outside the app shell). */
export function StatusPage({
  kind,
  title,
  body,
  homeLabel,
  action,
}: {
  kind: "not-found" | "error";
  title: string;
  body: string;
  homeLabel: string;
  action?: React.ReactNode;
}) {
  const Icon = kind === "not-found" ? FileQuestion : TriangleAlert;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground [&_svg]:size-7">
        <Icon aria-hidden />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {action}
        <Button asChild variant={action ? "secondary" : "primary"}>
          <Link href="/dashboard">{homeLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
