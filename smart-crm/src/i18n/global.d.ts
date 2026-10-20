import type { he } from "./messages.generated";
import type { Locale } from "./config";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof he;
  }
}
