import { MessageCircle } from "lucide-react";
import type { SocialLink } from "@/lib/links";
import { InstagramIcon, TikTokIcon } from "@/components/ui/SocialIcons";

const iconFor = {
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  whatsapp: MessageCircle,
} as const;

export function SocialIconLink({ social }: { social: SocialLink }) {
  const Icon = iconFor[social.id];
  return (
    <a
      href={social.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${social.label} (נפתח בחלון חדש)`}
      className="grid h-11 w-11 place-items-center rounded-full border border-ink/15 text-ink transition-colors hover:border-ink/60"
    >
      <Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.6} />
    </a>
  );
}
