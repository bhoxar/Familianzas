/** Piezas visuales chicas y reutilizables. */
import type { ReactNode } from "react";

export function Tarjeta({ titulo, accion, children, className = "" }: {
  titulo?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-borde bg-superficie p-4 shadow-sm ${className}`}>
      {(titulo || accion) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {titulo && <h2 className="text-xs font-semibold uppercase tracking-wide text-suave">{titulo}</h2>}
          {accion}
        </header>
      )}
      {children}
    </section>
  );
}

/** Barra de progreso accesible. `valor` y `total` en las mismas unidades. */
export function BarraProgreso({ valor, total, etiqueta, tono = "marca" }: {
  valor: number; total: number; etiqueta: string; tono?: "marca" | "rojo" | "naranja" | "gris";
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (valor / total) * 100)) : 0;
  const color = { marca: "bg-marca", rojo: "bg-rojo", naranja: "bg-naranja", gris: "bg-suave/40" }[tono];
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-2.5 w-full overflow-hidden rounded-full bg-borde"
    >
      <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Boton({ children, onClick, variante = "primario", disabled, type = "button", className = "" }: {
  children: ReactNode; onClick?: () => void; variante?: "primario" | "secundario" | "fantasma";
  disabled?: boolean; type?: "button" | "submit"; className?: string;
}) {
  const estilos = {
    primario: "bg-marca text-white active:opacity-90",
    secundario: "bg-marca-suave text-marca active:opacity-80",
    fantasma: "text-marca underline-offset-2 hover:underline",
  }[variante];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-12 rounded-xl px-4 text-base font-semibold transition disabled:opacity-40 ${estilos} ${className}`}
    >
      {children}
    </button>
  );
}

const COLORES_SEMAFORO = {
  al_dia: "bg-ok", gracia: "bg-yellow-400", atrasado: "bg-yellow-500", moroso: "bg-naranja", critico: "bg-rojo",
} as const;
const TEXTO_SEMAFORO = {
  al_dia: "Al día", gracia: "En gracia", atrasado: "Atrasado", moroso: "Moroso", critico: "Crítico",
} as const;

export function PuntoSemaforo({ estado }: { estado: keyof typeof COLORES_SEMAFORO }) {
  return (
    <span className="inline-flex items-center" title={TEXTO_SEMAFORO[estado]}>
      <span aria-hidden className={`inline-block size-3 rounded-full ${COLORES_SEMAFORO[estado]}`} />
      <span className="sr-only">{TEXTO_SEMAFORO[estado]}</span>
    </span>
  );
}
