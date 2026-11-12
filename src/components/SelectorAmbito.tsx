"use client";
/**
 * Interruptor global Negocio / Familia.
 * Cambia el tema de color (data-ambito en <html>) y lo que muestra toda la app.
 */
import { useAmbito } from "@/lib/estado/ambito";
import type { Ambito } from "@/lib/dominio/tipos";

const OPCIONES: { valor: Ambito; texto: string; icono: string }[] = [
  { valor: "empresa", texto: "Negocio", icono: "🐴" },
  { valor: "familia", texto: "Familia", icono: "🏠" },
];

export function SelectorAmbito() {
  const { ambito, cambiarAmbito } = useAmbito();
  return (
    <div role="radiogroup" aria-label="Ver dinero de" className="flex rounded-full bg-borde/70 p-1">
      {OPCIONES.map((o) => {
        const activo = ambito === o.valor;
        return (
          <button
            key={o.valor}
            role="radio"
            aria-checked={activo}
            onClick={() => cambiarAmbito(o.valor)}
            className={`flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
              activo ? "bg-marca text-white shadow" : "text-suave"
            }`}
          >
            <span aria-hidden>{o.icono}</span>
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}
