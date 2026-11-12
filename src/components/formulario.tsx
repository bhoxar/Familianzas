"use client";
/** Piezas de formulario y hoja inferior (modal) reutilizables. */
import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactNode } from "react";
import { aCentavos } from "@/lib/dominio/utiles";

/**
 * Etiqueta + campo. La etiqueta se vincula al control con htmlFor/id (y no
 * envolviéndolo), así el lector de pantalla no lee las opciones del select
 * como parte del nombre.
 */
export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
    ? cloneElement(children, { id, ...(ayuda ? { "aria-describedby": idAyuda } : {}) })
    : children;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-suave">{etiqueta}</label>
      {control}
      {ayuda && <span id={idAyuda} className="mt-1 block text-xs text-suave">{ayuda}</span>}
    </div>
  );
}

/** Convierte el texto de un campo de monto a centavos (0 si está vacío o es inválido). */
export function leerMonto(texto: string): number {
  if (!texto.trim()) return 0;
  try {
    return aCentavos(texto);
  } catch {
    return 0;
  }
}

export function EntradaMonto({ valor, onChange, grande, placeholder = "$ 0", etiqueta, id, ...resto }: {
  valor: string; onChange: (v: string) => void; grande?: boolean; placeholder?: string; etiqueta?: string; id?: string;
  "aria-describedby"?: string;
}) {
  return (
    <input
      id={id}
      aria-describedby={resto["aria-describedby"]}
      aria-label={etiqueta}
      inputMode="decimal"
      placeholder={placeholder}
      value={valor}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
      className={`campo cifra ${grande ? "text-3xl font-bold" : ""}`}
    />
  );
}

/** Hoja que sube desde abajo (modal accesible con <dialog>). */
export function Hoja({ abierta, onCerrar, titulo, children }: {
  abierta: boolean; onCerrar: () => void; titulo: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierta && !d.open) d.showModal();
    if (!abierta && d.open) d.close();
  }, [abierta]);
  return (
    <dialog
      ref={ref}
      onClose={onCerrar}
      onClick={(e) => e.target === ref.current && onCerrar()}
      className="m-0 mt-auto w-full max-w-none rounded-t-3xl bg-superficie p-0 text-texto backdrop:bg-black/40 sm:mx-auto sm:max-w-md"
    >
      <div className="max-h-[85dvh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full text-2xl text-suave">×</button>
        </header>
        {abierta && children}
      </div>
    </dialog>
  );
}

export function Mensaje({ aviso }: { aviso: { tipo: "ok" | "error"; texto: string } | null }) {
  if (!aviso) return null;
  return (
    <div role={aviso.tipo === "error" ? "alert" : "status"}
      className={`rounded-xl p-3 text-sm ${aviso.tipo === "ok" ? "bg-marca-suave text-marca" : "bg-rojo-suave text-rojo"}`}>
      {aviso.texto}
    </div>
  );
}

export function Interruptor({ activo, onChange, etiqueta }: { activo: boolean; onChange: (v: boolean) => void; etiqueta: string }) {
  return (
    <button type="button" role="switch" aria-checked={activo} onClick={() => onChange(!activo)}
      className="flex min-h-12 w-full items-center justify-between gap-3 text-left">
      <span>{etiqueta}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${activo ? "bg-marca" : "bg-borde"}`}>
        <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition ${activo ? "left-[1.4rem]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
