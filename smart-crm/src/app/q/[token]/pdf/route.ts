import { NextResponse, type NextRequest } from "next/server";
import { requestInfo } from "@/server/auth";
import { hitRateLimit } from "@/server/rate-limit";
import { pdfResponse } from "@/modules/documents/http";
import { publicQuotePdf } from "@/modules/documents/service";

/** Customer PDF download; the token in the path is the only credential. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/q/[token]/pdf">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { ip } = await requestInfo();
  const limit = await hitRateLimit(`quote-pdf-ip:${ip ?? "unknown"}`, 60, 3600);
  if (!limit.allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const pdf = await publicQuotePdf(token);
  if (!pdf) return NextResponse.json({ error: "not found" }, { status: 404 });
  const res = pdfResponse(pdf.bytes, pdf.fileName);
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
