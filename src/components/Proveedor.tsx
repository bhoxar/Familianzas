"use client";
/**
 * Arranque de la app en el cliente:
 *  - decide a qué pantalla ir (demo, entrar, bienvenida o la app);
 *  - sincronización automática con Supabase (al volver la señal, al abrir, cada minuto);
 *  - cotización del dólar del día (si hay señal y todavía no se cargó);
 *  - registra el service worker para abrir la app sin señal;
 *  - aplica el tema del ámbito en <html data-ambito>.
 */
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAmbito } from "@/lib/estado/ambito";
import { useArranque } from "@/lib/estado/sesion";
import { useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import { iniciarSyncAutomatica, supabase } from "@/lib/offline/sync";
import { guardarCotizacion, obtenerDolarBlue } from "@/lib/offline/operaciones";
import { hoy } from "@/lib/dominio/utiles";
import { SelectorAmbito } from "./SelectorAmbito";
import { IndicadorSync } from "./IndicadorSync";
import { BarraNavegacion } from "./BarraNavegacion";

const RUTAS_LIBRES = ["/entrar", "/bienvenida"];

export function Proveedor({ children }: { children: ReactNode }) {
  const ambito = useAmbito((s) => s.ambito);
  const estado = useArranque();
  const ruta = usePathname();
  const router = useRouter();
  const s = useInstantanea();

  // Tema
  useEffect(() => {
    document.documentElement.dataset.ambito = ambito;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ambito === "empresa" ? "#0f5e75" : "#2f7d3a");
  }, [ambito]);

  // Service worker (solo en producción)
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  // Sincronización
  useEffect(() => (supabase() ? iniciarSyncAutomatica(db()) : undefined), []);

  // Redirecciones según el estado
  useEffect(() => {
    if (estado === "cargando") return;
    const destino =
      estado === "sin_sesion" ? "/entrar" : estado === "sin_hogar" || estado === "sin_configurar" ? "/bienvenida" : null;
    if (destino && ruta !== destino) router.replace(destino);
    if (!destino && RUTAS_LIBRES.includes(ruta)) router.replace("/");
  }, [estado, ruta, router]);

  // Dólar del día: una vez por día, si hay señal
  useEffect(() => {
    if (estado !== "listo" || !s || !navigator.onLine) return;
    const fecha = hoy();
    if (s.cotizaciones.some((c) => c.fecha === fecha)) return;
    void obtenerDolarBlue().then((d) => d && guardarCotizacion(db(), s, { ...d, fecha, fuente: "automatica" }));
  }, [estado, s]);

  const pantallaLibre = RUTAS_LIBRES.includes(ruta);
  if (pantallaLibre) {
    return <div className="mx-auto min-h-dvh max-w-md px-4 py-6">{children}</div>;
  }
  if (estado !== "listo") {
    return (
      <div className="grid min-h-dvh place-items-center text-suave" aria-busy="true">
        Cargando…
      </div>
    );
  }
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
