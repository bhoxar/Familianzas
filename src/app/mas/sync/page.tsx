"use client";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEsDemo } from "@/lib/estado/datos";
import { db, type CambioPendiente } from "@/lib/offline/db";
import { descartarLote, reintentarLote, sincronizar, supabase } from "@/lib/offline/sync";
import { Boton, Tarjeta } from "@/components/ui";
import { Mensaje } from "@/components/formulario";

const NOMBRES: Record<string, string> = {
  transacciones: "movimiento", asignaciones: "asignación a sobre", cargos: "deuda de cliente", cobros_aplicados: "cobro",
  embudo_distribuciones: "reparto del sueldo", cuentas: "cuenta", sobres: "sobre", deudores: "cliente", deudas_propias: "deuda",
  reglas_embudo: "paso del sueldo", config_embudo: "configuración", cotizaciones: "cotización", unidades_negocio: "negocio", hogares: "hogar",
};

export default function Sync() {
  const demo = useEsDemo();
  const cola = useLiveQuery(() => db().outbox.toArray(), [], [] as CambioPendiente[]);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const lotes = new Map<string, CambioPendiente[]>();
  for (const c of cola) lotes.set(c.lote, [...(lotes.get(c.lote) ?? []), c]);
  const rechazados = [...lotes.entries()].filter(([, cs]) => cs[0].error);
  const pendientes = [...lotes.entries()].filter(([, cs]) => !cs[0].error);

  const describir = (cs: CambioPendiente[]) => {
    const t = cs.find((c) => c.tabla === "transacciones")?.fila as { descripcion?: string; monto?: number } | undefined;
    return t?.descripcion ?? [...new Set(cs.map((c) => NOMBRES[c.tabla] ?? c.tabla))].join(", ");
  };

  if (demo) return <Tarjeta titulo="Sincronización"><p>En el modo demostración no se sube nada a internet.</p></Tarjeta>;
  if (!supabase()) return <Tarjeta titulo="Sincronización"><p>Los datos se guardan solo en este teléfono (no hay servidor configurado).</p></Tarjeta>;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Sincronización</h1>
      <Mensaje aviso={aviso} />
      <Tarjeta titulo="Por subir">
        <p>{pendientes.length ? `${pendientes.length} cambio(s) guardados en el teléfono.` : "Todo subido. ✓"}</p>
        <Boton variante="secundario" className="mt-3 w-full" onClick={async () => {
          try { await sincronizar(db()); setAviso({ tipo: "ok", texto: "Sincronizado." }); }
          catch { setAviso({ tipo: "error", texto: "Sin conexión. Se reintenta solo cuando vuelva la señal." }); }
        }}>Sincronizar ahora</Boton>
      </Tarjeta>
      {rechazados.length > 0 && (
        <Tarjeta titulo="⚠ Para revisar">
          <p className="mb-2 text-sm text-suave">El servidor no aceptó estos cambios. Podés descartarlos o reintentar.</p>
          <ul className="space-y-3">
            {rechazados.map(([lote, cs]) => (
              <li key={lote} className="rounded-xl border border-borde p-3">
                <p className="font-semibold">{describir(cs)}</p>
                <p className="text-sm text-rojo">{cs[0].error}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Boton variante="secundario" onClick={() => reintentarLote(db(), lote)}>Reintentar</Boton>
                  <Boton variante="fantasma" className="text-rojo" onClick={() => confirm("¿Descartar este cambio?") && descartarLote(db(), lote)}>Descartar</Boton>
                </div>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </div>
  );
}
