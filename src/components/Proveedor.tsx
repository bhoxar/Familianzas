"use client";
/**
 * Arranque de la app en el cliente:
 *  - sin Supabase configurado => carga la demo local;
 *  - con Supabase => sincronización automática (al volver la señal, al abrir, cada minuto);
 *  - aplica el tema del ámbito en <html data-ambito>.
 */
import { useEffect, type ReactNode } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { db, leerMeta } from "@/lib/offline/db";
import { iniciarSyncAutomatica, supabase } from "@/lib/offline/sync";
import { cargarDemo } from "@/lib/demo/cargar";
import { hoy } from "@/lib/dominio/utiles";
import { SelectorAmbito } from "./SelectorAmbito";
import { IndicadorSync } from "./IndicadorSync";
import { BarraNavegacion } from "./BarraNavegacion";

export function Proveedor({ children }: { children: ReactNode }) {
  const ambito = useAmbito((s) => s.ambito);

  useEffect(() => {
    document.documentElement.dataset.ambito = ambito;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ambito === "empresa" ? "#0f5e75" : "#2f7d3a");
  }, [ambito]);

  useEffect(() => {
    const base = db();
    if (!supabase()) {
      void leerMeta(base, "hogar_id").then((h) => (h ? undefined : cargarDemo(base, hoy())));
      return;
    }
    return iniciarSyncAutomatica(base);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-borde bg-fondo/95 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <SelectorAmbito />
        <IndicadorSync />
      </header>
      <main className="flex-1 px-4 pb-28 pt-3">{children}</main>
      <BarraNavegacion />
    </div>
  );
}
