"use client";
/**
 * CARGA RÁPIDA (＋): monto → qué fue → de dónde. Funciona sin señal.
 * Solo muestra sobres y cuentas del modo actual: no se puede mezclar.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAmbito } from "@/lib/estado/ambito";
import { useEsDemo, useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import { registrarMovimiento } from "@/lib/offline/repositorio";
import { cotizacionVigente, saldosSobres } from "@/lib/dominio/calculos";
import { dolares, hoy, pesos, vivos } from "@/lib/dominio/utiles";
import { Boton } from "@/components/ui";
import { Campo, EntradaMonto, leerMonto, Mensaje } from "@/components/formulario";

type Tipo = "gasto" | "ingreso";

export default function CargaRapida() {
  const { ambito } = useAmbito();
  const s = useInstantanea();
  const demo = useEsDemo();
  const router = useRouter();
  const [tipo, setTipo] = useState<Tipo>("gasto");
  const [montoTxt, setMontoTxt] = useState("");
  const [sobreId, setSobreId] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [unidadId, setUnidadId] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const opciones = useMemo(() => {
    if (!s) return null;
    const usados = new Map<string, number>();
    for (const t of s.transacciones) if (t.sobre_id) usados.set(t.sobre_id, (usados.get(t.sobre_id) ?? 0) + 1);
    const disp = new Map(saldosSobres(s, fecha).map((x) => [x.sobre.id, x.disponible]));
    const sobres = vivos(s.sobres)
      .filter((o) => o.ambito === ambito && o.tipo !== "sueldo")
      .sort((a, b) => (usados.get(b.id) ?? 0) - (usados.get(a.id) ?? 0) || a.prioridad - b.prioridad);
    const cuentas = vivos(s.cuentas).filter(
      (c) => !c.archivada && (c.ambito === ambito || c.compartida) && (tipo === "gasto" || c.tipo !== "tarjeta_credito"),
    );
    return { sobres, cuentas, disp, unidades: vivos(s.unidades).filter((u) => u.activa) };
  }, [s, ambito, tipo, fecha]);

  if (!s || !opciones) return null;

  const cuenta = opciones.cuentas.find((c) => c.id === cuentaId) ?? opciones.cuentas[0];
  const enDolares = cuenta?.moneda === "USD";
  const monto = leerMonto(montoTxt);
  const necesitaSobre = tipo === "gasto";
  const listo = monto > 0 && cuenta && (!necesitaSobre || sobreId);
  const cot = cotizacionVigente(s, fecha);

  const guardar = async () => {
    if (!listo || !cuenta) return;
    setGuardando(true);
    setAviso(null);
    try {
      const { embudo } = await registrarMovimiento(db(), s, {
        cuenta_id: cuenta.id, tipo, fecha, monto, sobre_id: necesitaSobre ? sobreId : null,
        unidad_negocio_id: tipo === "ingreso" && ambito === "empresa" ? unidadId ?? opciones.unidades[0]?.id ?? null : null,
        descripcion: descripcion || undefined, ambito,
      });
      const donde = demo ? "" : navigator.onLine ? " ✓" : " · guardado en el teléfono ⏳";
      let texto = `${tipo === "gasto" ? "Gasto" : "Ingreso"} de ${enDolares ? dolares(monto) : pesos(monto)} guardado${donde}.`;
      if (embudo?.pasos.length) texto += ` Se repartió: ${embudo.pasos.map((p) => `${pesos(p.monto)} a ${p.regla.nombre}`).join(" · ")}.`;
      setAviso({ tipo: "ok", texto });
      setMontoTxt("");
      setDescripcion("");
      setSobreId(null);
    } catch (err) {
      setAviso({ tipo: "error", texto: (err as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Cargar en {ambito === "empresa" ? "🐴 Negocio" : "🏠 Familia"}</h1>
        <button onClick={() => router.back()} className="text-sm text-suave">Cerrar</button>
      </div>

      {/* Monto */}
      <div>
        <div role="radiogroup" aria-label="Tipo" className="mb-2 grid grid-cols-2 gap-2">
          {(["gasto", "ingreso"] as const).map((t) => (
            <button key={t} role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)}
              className={`min-h-11 rounded-xl font-semibold ${tipo === t ? "bg-marca text-white" : "bg-superficie text-suave border border-borde"}`}>
              {t === "gasto" ? "− Gasto" : "+ Ingreso"}
            </button>
          ))}
        </div>
        <EntradaMonto grande etiqueta="Monto" valor={montoTxt} onChange={setMontoTxt} placeholder={enDolares ? "US$ 0" : "$ 0"} />
        {enDolares && monto > 0 && cot && (
          <p className="mt-1 text-sm text-suave">≈ {pesos(Math.round(monto * cot.promedio))} al promedio {pesos(cot.promedio * 100)}</p>
        )}
      </div>

      {/* Qué fue */}
      {necesitaSobre ? (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-suave">¿QUÉ FUE?</legend>
          <div className="flex flex-wrap gap-2">
            {opciones.sobres.map((o) => {
              const d = opciones.disp.get(o.id) ?? 0;
              return (
                <button key={o.id} onClick={() => setSobreId(o.id)} aria-pressed={sobreId === o.id}
                  className={`min-h-11 rounded-xl border px-3 text-left text-sm ${sobreId === o.id ? "border-marca bg-marca text-white" : "border-borde bg-superficie"}`}>
                  {o.nombre}
                  <span className={`block text-xs ${sobreId === o.id ? "text-white/80" : d < 0 ? "text-rojo" : "text-suave"}`}>quedan {pesos(d)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : ambito === "empresa" ? (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-suave">¿DE QUÉ NEGOCIO?</legend>
          <div className="flex flex-wrap gap-2">
            {opciones.unidades.map((u) => {
              const activo = (unidadId ?? opciones.unidades[0]?.id) === u.id;
              return (
                <button key={u.id} onClick={() => setUnidadId(u.id)} aria-pressed={activo}
                  className={`min-h-11 rounded-xl border px-3 text-sm ${activo ? "border-marca bg-marca text-white" : "border-borde bg-superficie"}`}>
                  {u.nombre}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-suave">
            ¿Es el pago de un cliente? Cargalo desde <Link href="/negocio/me-deben" className="font-semibold text-marca">Me deben</Link> para descontar su deuda.
          </p>
        </fieldset>
      ) : (
        <p className="text-sm text-suave">El ingreso queda como plata sin destino para repartir en sobres.</p>
      )}

      {/* De dónde */}
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-suave">{tipo === "gasto" ? "¿DE DÓNDE SALIÓ?" : "¿DÓNDE ENTRÓ?"}</legend>
        <div className="grid grid-cols-2 gap-2">
          {opciones.cuentas.map((c) => (
            <button key={c.id} onClick={() => setCuentaId(c.id)} aria-pressed={cuenta?.id === c.id}
              className={`min-h-11 rounded-xl border px-3 text-left text-sm ${cuenta?.id === c.id ? "border-marca bg-marca text-white" : "border-borde bg-superficie"}`}>
              {c.tipo === "tarjeta_credito" ? "💳 " : c.moneda === "USD" ? "💵 " : ""}{c.nombre}
            </button>
          ))}
        </div>
      </fieldset>

      <details className="rounded-xl border border-borde bg-superficie p-3">
        <summary className="text-sm text-suave">Fecha y detalle (opcional)</summary>
        <div className="mt-3 space-y-3">
          <Campo etiqueta="Fecha"><input type="date" value={fecha} max={hoy()} onChange={(e) => setFecha(e.target.value)} className="campo" /></Campo>
          <Campo etiqueta="Detalle"><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} className="campo" /></Campo>
        </div>
      </details>

      <Mensaje aviso={aviso} />
      <Boton className="w-full" disabled={!listo || guardando} onClick={guardar}>Guardar</Boton>
    </div>
  );
}
