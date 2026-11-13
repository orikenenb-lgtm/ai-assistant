/** Server/untrusted text rendered as text (React escapes it). */
export function PlainTextLine({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}
