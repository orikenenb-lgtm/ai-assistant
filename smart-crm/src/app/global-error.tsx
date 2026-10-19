"use client";

/** Last-resort boundary (the root layout itself failed): static bilingual text, no providers. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center" }}>
        <div>
          <h1 style={{ fontSize: 20 }}>אירעה שגיאה · Something went wrong</h1>
          <p style={{ color: "#666" }}>נסו שוב בעוד רגע · Please try again in a moment.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}>
            נסו שוב · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
