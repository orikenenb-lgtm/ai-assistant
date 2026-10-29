import Link from "next/link";
import { SimplePage } from "@/components/layout/SimplePage";
import { buttonClass } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <SimplePage title="העמוד לא נמצא">
      <p>הקישור שבור או שהעמוד הועבר. אבל הנציגה שלנו עדיין עונה, מבטיחים.</p>
      <p>
        <Link href="/" className={buttonClass("primary", "lg")}>
          חזרה לעמוד הבית
        </Link>
      </p>
    </SimplePage>
  );
}
