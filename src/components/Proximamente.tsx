import Link from "next/link";
import { Tarjeta } from "./ui";

/** Pantallas definidas en la Fase 2 que se construyen en la siguiente iteración. */
export function Proximamente({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <Tarjeta titulo={titulo}>
      <p>{descripcion}</p>
      <p className="mt-2 text-sm text-suave">Esta pantalla está diseñada (ver docs/fase-2-ui-ux.md) y se construye en la próxima etapa.</p>
      <Link href="/" className="mt-3 inline-block font-semibold text-marca">‹ Volver al inicio</Link>
    </Tarjeta>
  );
}
