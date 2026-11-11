"use client";
/** DEBEMOS: deudas del ámbito actual, orden de ataque y simulador de salida. */
import { useMemo, useState } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import { cambiarEstrategia, eliminarEntidad, guardarEntidad, pagarDeuda } from "@/lib/offline/operaciones";
import { estadoDeudas, ordenarDeudas, simularSalida, type EstadoDeuda } from "@/lib/dominio/deudas";
import type { Instantanea } from "@/lib/dominio/calculos";
import type { DeudaPropia, EstrategiaDeuda, TipoDeuda } from "@/lib/dominio/tipos";
import { pesos, sumar, vivos } from "@/lib/dominio/utiles";
import { Boton, Tarjeta } from "./ui";
import { Campo, EntradaMonto, Hoja, leerMonto, Mensaje } from "./formulario";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;
const TIPOS: { valor: TipoDeuda; texto: string }[] = [
  { valor: "tarjeta", texto: "Tarjeta" }, { valor: "prestamo", texto: "Préstamo" },
  { valor: "compra_en_cuotas", texto: "Compra en cuotas" }, { valor: "plan_ahorro", texto: "Plan de ahorro (auto)" },
  { valor: "proveedor", texto: "Proveedor" }, { valor: "otro", texto: "Otra" },
];

const meses = (n: number) => (n >= 12 ? `${Math.floor(n / 12)} año${n >= 24 ? "s" : ""}${n % 12 ? ` y ${n % 12} mes${n % 12 > 1 ? "es" : ""}` : ""}` : `${n} mes${n === 1 ? "" : "es"}`);

export function PantallaDeudas() {
  const { ambito } = useAmbito();
  const s = useInstantanea();
  const [extra, setExtra] = useState("");
  const [pagando, setPagando] = useState<EstadoDeuda | null>(null);
  const [editando, setEditando] = useState<Partial<DeudaPropia> | null>(null);

  const estrategia: EstrategiaDeuda = s?.hogar.estrategia_deuda ?? "avalancha";
  const datos = useMemo(() => {
    if (!s) return null;
    const estados = estadoDeudas(s.deudas, s.transacciones).filter((e) => e.deuda.ambito === ambito);
    return { orden: ordenarDeudas(estados, estrategia), estados };
  }, [s, ambito, estrategia]);
  const sim = useMemo(() => {
    if (!datos?.estados.length) return null;
    const e = leerMonto(extra);
    return {
      base: simularSalida(datos.estados, estrategia, 0),
      avalancha: simularSalida(datos.estados, "avalancha", e),
      bola: simularSalida(datos.estados, "bola_de_nieve", e),
    };
  }, [datos, extra, estrategia]);

  if (!s || !datos) return null;
  const total = sumar(datos.estados.map((e) => e.saldo));
  const primeraAtacable = datos.orden.find((e) => !(e.deuda.tasa_anual === 0 && e.deuda.cuotas_total));
  const elegido = estrategia === "avalancha" ? sim?.avalancha : sim?.bola;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-bold">Debemos {ambito === "empresa" ? "(Negocio)" : "(Familia)"}</h1>
          <p className="cifra text-3xl font-bold">{pesos(total)}</p>
        </div>
        <Boton variante="secundario" onClick={() => setEditando({ ambito, tipo: "otro", moneda: "ARS", tasa_anual: 0, cuotas_pagadas_al_cargar: 0, cancelada: false })}>+ Deuda</Boton>
      </div>

      <Tarjeta titulo="Estrategia">
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {(["avalancha", "bola_de_nieve"] as const).map((e) => (
            <button key={e} role="radio" aria-checked={estrategia === e} onClick={() => cambiarEstrategia(db(), s, e)}
              className={`min-h-11 rounded-xl text-sm font-semibold ${estrategia === e ? "bg-marca text-white" : "border border-borde text-suave"}`}>
              {e === "avalancha" ? "🏔 Avalancha" : "⛄ Bola de nieve"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-suave">
          {estrategia === "avalancha"
            ? "Primero la de mayor interés: es la que más plata ahorra."
            : "Primero la más chica: se cancelan deudas rápido y da ánimo para seguir."}
          {" "}Siempre se paga el mínimo de todas.
        </p>
      </Tarjeta>

      {datos.orden.length === 0 && <p className="text-center text-suave">No hay deudas cargadas en este ámbito. 🎉</p>}
      <ol className="space-y-2">
        {datos.orden.map((e, i) => {
          const atacar = e === primeraAtacable;
          return (
            <li key={e.deuda.id} className={`rounded-2xl border bg-superficie p-4 ${atacar ? "border-marca" : "border-borde"}`}>
              <div className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-marca text-xs font-bold text-white">{i + 1}</span>
                <button className="flex-1 text-left" onClick={() => setEditando(e.deuda)}>
                  <p className="font-semibold">{e.deuda.acreedor}</p>
                  <p className="text-xs text-suave">
                    {e.deuda.tasa_anual ? `${e.deuda.tasa_anual}% anual · ~${pesos(e.interesMensual)}/mes de interés` : "Sin interés"}
                    {e.cuotasRestantes != null ? ` · faltan ${e.cuotasRestantes} cuotas` : ""}
                    {e.deuda.pago_minimo ? ` · mínimo ${pesos(e.deuda.pago_minimo)}` : ""}
                  </p>
                </button>
                <span className="cifra font-bold">{pesos(e.saldo)}</span>
              </div>
              {atacar && <p className="mt-2 text-sm font-semibold text-marca">← Toda plata extra va acá</p>}
              <Boton variante="secundario" className="mt-3 w-full" onClick={() => setPagando(e)}>Registrar pago</Boton>
            </li>
          );
        })}
      </ol>

      {sim && (
        <Tarjeta titulo="¿Cuándo salimos?">
          <Campo etiqueta="Si pagamos de más por mes…"><EntradaMonto valor={extra} onChange={setExtra} placeholder="$ 0 extra" /></Campo>
          {elegido && (
            <div className="mt-3 space-y-1 text-sm">
              {elegido.sinSalida ? (
                <p className="font-semibold text-rojo">Con estos pagos la deuda no baja: el mínimo no cubre los intereses. Sumá plata extra.</p>
              ) : (
                <>
                  <p>Sin deudas en <b>{meses(elegido.meses)}</b>{!sim.base.sinSalida && leerMonto(extra) > 0 ? ` (en vez de ${meses(sim.base.meses)})` : ""}.</p>
                  <p>Intereses a pagar: <b className="cifra">{pesos(elegido.interesesTotales)}</b>
                    {!sim.base.sinSalida && leerMonto(extra) > 0 ? ` · ahorrás ${pesos(sim.base.interesesTotales - elegido.interesesTotales)}` : ""}</p>
                  {sim.base.sinSalida && leerMonto(extra) > 0 && (
                    <p className="font-semibold text-naranja">Ojo: pagando solo el mínimo, la deuda no baja nunca (el mínimo apenas cubre el interés).</p>
                  )}
                  {leerMonto(extra) > 0 && datos.estados.length > 1 && (
                    <p className="text-xs text-suave">
                      Avalancha: {meses(sim.avalancha.meses)}, {pesos(sim.avalancha.interesesTotales)} de interés ·
                      Bola de nieve: {meses(sim.bola.meses)}, {pesos(sim.bola.interesesTotales)}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </Tarjeta>
      )}

      <Hoja abierta={!!pagando} onCerrar={() => setPagando(null)} titulo={`Pago · ${pagando?.deuda.acreedor ?? ""}`}>
        {pagando && <FormPago s={s} e={pagando} onListo={() => setPagando(null)} />}
      </Hoja>
      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo={editando?.id ? "Editar deuda" : "Nueva deuda"}>
        {editando && <FormDeuda s={s} inicial={editando} onListo={() => setEditando(null)} />}
      </Hoja>
    </div>
  );
}

function FormPago({ s, e, onListo }: { s: Instantanea; e: EstadoDeuda; onListo: () => void }) {
  const cuentas = vivos(s.cuentas).filter((c) => !c.archivada && (c.ambito === e.deuda.ambito || c.compartida));
  const [cuentaId, setCuentaId] = useState(e.deuda.cuenta_tarjeta_id ?? cuentas.find((c) => c.tipo !== "tarjeta_credito")?.id ?? "");
  const [monto, setMonto] = useState(e.deuda.pago_minimo ? String(Math.min(e.deuda.pago_minimo, e.saldo) / 100) : "");
  const [aviso, setAviso] = useState<Aviso>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-suave">Saldo: <b className="cifra">{pesos(e.saldo)}</b></p>
      <Campo etiqueta="Monto"><EntradaMonto valor={monto} onChange={setMonto} /></Campo>
      <Campo etiqueta="Pagado con" ayuda="Si la cuota se debita de la tarjeta, elegí la tarjeta: va a su resumen.">
        <select value={cuentaId} onChange={(ev) => setCuentaId(ev.target.value)} className="campo">
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.tipo === "tarjeta_credito" ? "💳 " : ""}{c.nombre}</option>)}
        </select>
      </Campo>
      <Mensaje aviso={aviso} />
      <Boton className="w-full" onClick={async () => {
        try { await pagarDeuda(db(), s, { deudaId: e.deuda.id, cuentaId, monto: leerMonto(monto) }); onListo(); }
        catch (err) { setAviso({ tipo: "error", texto: (err as Error).message }); }
      }}>Registrar pago</Boton>
    </div>
  );
}

function FormDeuda({ s, inicial, onListo }: { s: Instantanea; inicial: Partial<DeudaPropia>; onListo: () => void }) {
  const t = (v?: number | null) => (v ? String(v / 100) : "");
  const [d, setD] = useState({ ...inicial, saldoTxt: t(inicial.saldo_inicial), minimoTxt: t(inicial.pago_minimo) });
  const [aviso, setAviso] = useState<Aviso>(null);
  const tarjetas = vivos(s.cuentas).filter((c) => c.tipo === "tarjeta_credito" && (c.ambito === d.ambito || c.compartida));
  const sobres = vivos(s.sobres).filter((o) => o.ambito === d.ambito && o.tipo !== "sueldo");
  const guardar = async () => {
    const saldo = leerMonto(d.saldoTxt);
    if (!d.acreedor?.trim() || saldo <= 0) return setAviso({ tipo: "error", texto: "Completá a quién y cuánto se debe" });
    const { saldoTxt, minimoTxt, ...resto } = d;
    void saldoTxt;
    await guardarEntidad(db(), s, "deudas_propias", {
      ...resto, acreedor: d.acreedor.trim(), saldo_inicial: saldo, monto_original: Math.max(inicial.monto_original ?? 0, saldo),
      pago_minimo: leerMonto(minimoTxt), tasa_anual: Number(d.tasa_anual) || 0, moneda: d.moneda ?? "ARS",
      cuotas_pagadas_al_cargar: d.cuotas_pagadas_al_cargar ?? 0, cancelada: d.cancelada ?? false,
    });
    onListo();
  };
  return (
    <div className="space-y-3">
      <Campo etiqueta="¿A quién?"><input value={d.acreedor ?? ""} placeholder="Ej: Plan Toyota Hilux" onChange={(e) => setD({ ...d, acreedor: e.target.value })} className="campo" /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Tipo">
          <select value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as TipoDeuda })} className="campo">
            {TIPOS.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={inicial.id ? "Saldo al cargarla" : "Saldo hoy"}><EntradaMonto valor={d.saldoTxt} onChange={(v) => setD({ ...d, saldoTxt: v })} /></Campo>
        <Campo etiqueta="Interés anual (TNA %)" ayuda="0 si es sin interés">
          <input inputMode="decimal" value={d.tasa_anual ?? 0} onChange={(e) => setD({ ...d, tasa_anual: Number(e.target.value.replace(",", ".")) || 0 })} className="campo cifra" />
        </Campo>
        <Campo etiqueta="Pago mínimo / cuota"><EntradaMonto valor={d.minimoTxt} onChange={(v) => setD({ ...d, minimoTxt: v })} /></Campo>
        <Campo etiqueta="Cuotas totales">
          <input type="number" min={0} value={d.cuotas_total ?? ""} onChange={(e) => setD({ ...d, cuotas_total: e.target.value ? Number(e.target.value) : null })} className="campo" />
        </Campo>
        <Campo etiqueta="Cuotas ya pagadas">
          <input type="number" min={0} value={d.cuotas_pagadas_al_cargar ?? 0} onChange={(e) => setD({ ...d, cuotas_pagadas_al_cargar: Number(e.target.value) })} className="campo" />
        </Campo>
        <Campo etiqueta="Día de vencimiento">
          <input type="number" min={1} max={31} value={d.dia_vencimiento ?? ""} onChange={(e) => setD({ ...d, dia_vencimiento: e.target.value ? Number(e.target.value) : null })} className="campo" />
        </Campo>
        <Campo etiqueta="Se debita de">
          <select value={d.cuenta_tarjeta_id ?? ""} onChange={(e) => setD({ ...d, cuenta_tarjeta_id: e.target.value || null })} className="campo">
            <option value="">Se paga aparte</option>
            {tarjetas.map((c) => <option key={c.id} value={c.id}>💳 {c.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <Campo etiqueta="Sobre donde se presupuesta (opcional)">
        <select value={d.sobre_id ?? ""} onChange={(e) => setD({ ...d, sobre_id: e.target.value || null })} className="campo">
          <option value="">Ninguno</option>
          {sobres.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
      </Campo>
      <Mensaje aviso={aviso} />
      <Boton className="w-full" onClick={guardar}>Guardar</Boton>
      {inicial.id && (
        <Boton variante="fantasma" className="w-full text-rojo" onClick={async () => {
          if (confirm("¿Borrar esta deuda?")) { await eliminarEntidad(db(), "deudas_propias", inicial as DeudaPropia); onListo(); }
        }}>Borrar deuda</Boton>
      )}
    </div>
  );
}
