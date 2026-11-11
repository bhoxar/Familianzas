"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAmbito } from "@/lib/estado/ambito";

/** Barra inferior: cambia sus pestañas según el modo (Fase 2, sección 3). */
const PESTANAS = {
  empresa: [
    { href: "/", texto: "Inicio", icono: "◉" },
    { href: "/negocio/me-deben", texto: "Me deben", icono: "⏳" },
    { href: "/nuevo", texto: "Cargar", icono: "＋", central: true },
    { href: "/negocio/sueldo", texto: "Sueldo", icono: "💰" },
    { href: "/mas", texto: "Más", icono: "☰" },
  ],
  familia: [
    { href: "/", texto: "Inicio", icono: "◉" },
    { href: "/familia/sobres", texto: "Sobres", icono: "✉" },
    { href: "/nuevo", texto: "Cargar", icono: "＋", central: true },
    { href: "/familia/debemos", texto: "Debemos", icono: "📉" },
    { href: "/mas", texto: "Más", icono: "☰" },
  ],
} as const;

export function BarraNavegacion() {
  const { ambito } = useAmbito();
  const ruta = usePathname();
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-borde bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {PESTANAS[ambito].map((p) => {
          const activa = ruta === p.href;
          const central = "central" in p && p.central;
          return (
            <li key={p.href} className="flex justify-center">
              <Link
                href={p.href}
                aria-current={activa ? "page" : undefined}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  activa ? "text-marca" : "text-suave"
                }`}
              >
                {central ? (
                  <span aria-hidden className="-mt-5 grid size-12 place-items-center rounded-full bg-marca text-2xl text-white shadow-lg">
                    {p.icono}
                  </span>
                ) : (
                  <span aria-hidden className="text-lg leading-none">{p.icono}</span>
                )}
                {p.texto}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
