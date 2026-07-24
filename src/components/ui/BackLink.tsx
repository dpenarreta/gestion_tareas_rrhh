import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type BackLinkProps = {
  label: string;
  href?: string;
  onClick?: () => void;
  className?: string;
};

// Patrón único de "volver" (Sprint C §5) — antes había 3 implementaciones
// distintas (Link crudo, botón que resetea estado local, ícono sin label
// visible). Acepta href (navegación real) u onClick (reset de estado
// en-página) según lo que ya usaba cada sitio, sin cambiar su comportamiento.
export function BackLink({ label, href, onClick, className = "" }: BackLinkProps) {
  const classes = `inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary transition-colors w-fit ${className}`;

  const content = (
    <>
      <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} />
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}
