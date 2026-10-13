"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Pantalla controlada para un error de renderizado (p. ej. Django detenido o
 * reiniciándose: `DjangoUnavailableError`). No muestra la traza: en producción
 * Next.js ni siquiera envía el mensaje original al navegador, solo un
 * `digest` que coincide con el log del servidor, donde queda el detalle.
 */
export function ServiceErrorFallback({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[NEXO] Error al cargar la página", error.digest ?? error.message);
  }, [error]);

  return (
    <div role="alert" className="max-w-lg mx-auto my-16 p-6 bg-surface border border-border rounded-2xl text-center space-y-3">
      <h2 className="text-lg font-semibold text-title">No se pudo cargar esta sección</h2>
      <p className="text-sm text-secondary">
        El servicio de NEXO no está disponible temporalmente o no respondió a tiempo. Tus datos no se modificaron.
        Intenta de nuevo en unos segundos; si el problema continúa, avisa al administrador del sistema.
      </p>
      {error.digest && <p className="text-xs text-secondary">Referencia: {error.digest}</p>}
      <Button onClick={() => retry()}>Reintentar</Button>
    </div>
  );
}
