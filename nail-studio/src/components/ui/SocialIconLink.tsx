import { MessageCircle } from "lucide-react";
import type { SocialLink } from "@/lib/links";
import { cn } from "@/lib/utils";
import { InstagramIcon, TikTokIcon } from "@/components/ui/SocialIcons";

const iconFor = {
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  whatsapp: MessageCircle,
} as const;

export function SocialIconLink({ social, tone = "dark" }: { social: SocialLink; tone?: "dark" | "light" }) {
  const Icon = iconFor[social.id];
  return (
    <a
      href={social.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${social.label} (נפתח בחלון חדש)`}
      className={cn(
        "grid h-11 w-11 place-items-center rounded-full border transition-colors",
        tone === "light"
          ? "border-ivory/20 text-ivory hover:border-ivory/50 hover:bg-ivory/10"
          : "border-ink/10 text-ink hover:border-rose-300 hover:text-rose-600",
      )}
    >
      <Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.6} />
    </a>
  );
}
