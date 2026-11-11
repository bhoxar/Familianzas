"use client";
import { useEffect, useState } from "react";
import { useEstadoSync, useEsDemo } from "@/lib/estado/datos";

/** ⟳ N: movimientos guardados en el teléfono que todavía no se subieron. */
export function IndicadorSync() {
  const { pendientes, rechazados } = useEstadoSync();
  const demo = useEsDemo();
  const [enLinea, setEnLinea] = useState(true);

  useEffect(() => {
    const act = () => setEnLinea(navigator.onLine);
    act();
    window.addEventListener("online", act);
    window.addEventListener("offline", act);
    return () => {
      window.removeEventListener("online", act);
      window.removeEventListener("offline", act);
    };
  }, []);

  const texto = demo
    ? "Demo"
    : !enLinea
      ? `Sin señal${pendientes ? ` · ${pendientes}` : ""}`
      : pendientes
        ? `⟳ ${pendientes}`
        : "✓";
  const titulo = demo
    ? "Modo demostración: los datos quedan solo en este teléfono"
    : !enLinea
      ? "Sin señal: lo que cargues se guarda en el teléfono"
      : pendientes
        ? `${pendientes} movimiento(s) por subir`
        : "Todo sincronizado";

  return (
    <span
      title={titulo}
      aria-label={titulo}
      className={`inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold ${
        rechazados ? "bg-rojo-suave text-rojo" : !enLinea ? "bg-borde text-suave" : "bg-marca-suave text-marca"
      }`}
    >
      {rechazados ? `⚠ ${rechazados} para revisar` : texto}
    </span>
  );
}
