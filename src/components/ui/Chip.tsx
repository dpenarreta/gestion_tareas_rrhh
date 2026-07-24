import { Badge } from "./Badge";
import type { ChipConfig } from "@/lib/chipConfig";

type ChipProps = {
  value: string;
  config: ChipConfig;
  className?: string;
};

// Un único componente visual para prioridades y estados en toda la
// plataforma (Sprint B §3/§4) — el significado de cada valor (label + tono)
// lo define el `config` de src/lib/chipConfig.ts propio de cada dominio, pero
// el marcado/tamaño/tipografía es siempre el mismo.
function Chip({ value, config, className = "" }: ChipProps) {
  const entry = config[value];
  if (!entry) return <Badge variant="neutral" className={`rounded normal-case ${className}`}>{value}</Badge>;
  return (
    <Badge variant={entry.tone} className={`rounded normal-case ${className}`}>
      {entry.label}
    </Badge>
  );
}

export const PriorityChip = Chip;
export const StatusChip = Chip;
