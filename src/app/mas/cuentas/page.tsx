"use client";
/** Cuentas del ámbito actual con su saldo, y tarjetas con el resumen dividido por partes. */
import { useState } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import { guardarEntidad, pagarTarjeta } from "@/lib/offline/operaciones";
import { saldoCuenta, tarjetasPorAmbito, type Instantanea, type TarjetaAmbito } from "@/lib/dominio/calculos";
import type { Ambito, Cuenta, TipoCuenta } from "@/lib/dominio/tipos";
import { dolares, pesos, vivos } from "@/lib/dominio/utiles";
import { Boton, Tarjeta } from "@/components/ui";
import { Campo, EntradaMonto, Hoja, Interruptor, leerMonto, Mensaje } from "@/components/formulario";

const TIPOS: Record<TipoCuenta, string> = { banco: "🏦 Banco", efectivo: "💵 Efectivo", billetera_virtual: "📱 Billetera virtual", tarjeta_credito: "💳 Tarjeta" };

export default function Cuentas() {
  const { ambito } = useAmbito();
  const s = useInstantanea();
  const [editando, setEditando] = useState<Partial<Cuenta> | null>(null);
  const [pago, setPago] = useState<TarjetaAmbito | null>(null);
  if (!s) return null;

  const cuentas = vivos(s.cuentas).filter((c) => c.ambito === ambito && c.tipo !== "tarjeta_credito" && !c.archivada);
  const tarjetas = tarjetasPorAmbito(s);
  const nombreAmbito = (a: Ambito) => (a === "empresa" ? "🐴 Negocio" : "🏠 Familia");

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Cuentas de {ambito === "empresa" ? "Negocio" : "Familia"}</h1>
      <Tarjeta>
        <ul className="divide-y divide-borde">
          {cuentas.map((c) => {
            const saldo = saldoCuenta(c, s.transacciones);
            return (
              <li key={c.id}>
                <button className="flex min-h-12 w-full items-center justify-between gap-2 text-left" onClick={() => setEditando(c)}>
                  <span>{c.nombre}<span className="block text-xs text-suave">{TIPOS[c.tipo]}</span></span>
                  <span className={`cifra font-semibold ${saldo < 0 ? "text-rojo" : ""}`}>{c.moneda === "USD" ? dolares(saldo) : pesos(saldo)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <Boton variante="secundario" className="mt-3 w-full" onClick={() => setEditando({ ambito, tipo: "banco", moneda: "ARS", compartida: false, archivada: false, saldo_inicial: 0 })}>+ Cuenta</Boton>
      </Tarjeta>

      <h2 className="pt-2 text-sm font-semibold uppercase text-suave">Tarjetas</h2>
      {vivos(s.cuentas).filter((c) => c.tipo === "tarjeta_credito" && (c.ambito === ambito || c.compartida)).map((c) => {
        const partes = tarjetas.filter((t) => t.cuenta.id === c.id);
        return (
          <Tarjeta key={c.id} titulo={`💳 ${c.nombre}${c.dia_vencimiento ? ` · vence el ${c.dia_vencimiento}` : ""}`}
            accion={<button className="text-sm font-semibold text-marca" onClick={() => setEditando(c)}>Editar</button>}>
            <ul className="space-y-2">
              {partes.map((p) => (
                <li key={p.ambito} className="flex items-center gap-2">
                  <span className="flex-1">{nombreAmbito(p.ambito)} paga<span className="cifra block text-lg font-bold">{pesos(Math.max(p.deuda, 0))}</span></span>
                  {p.ambito === ambito && p.deuda > 0 && <Boton variante="secundario" onClick={() => setPago(p)}>Pagar</Boton>}
                </li>
              ))}
            </ul>
            {c.compartida && <p className="mt-2 text-xs text-suave">Compartida: cada gasto se imputa según su sobre, y cada parte paga lo suyo.</p>}
          </Tarjeta>
        );
      })}
      <Boton variante="fantasma" className="w-full" onClick={() => setEditando({ ambito, tipo: "tarjeta_credito", moneda: "ARS", compartida: true, archivada: false, saldo_inicial: 0 })}>+ Tarjeta</Boton>

      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo={editando?.id ? "Editar cuenta" : "Nueva cuenta"}>
        {editando && <FormCuenta s={s} inicial={editando} onListo={() => setEditando(null)} />}
      </Hoja>
      <Hoja abierta={!!pago} onCerrar={() => setPago(null)} titulo={`Pagar ${pago?.cuenta.nombre ?? ""}`}>
        {pago && <FormPagoTarjeta s={s} t={pago} onListo={() => setPago(null)} />}
      </Hoja>
    </div>
  );
}

function FormCuenta({ s, inicial, onListo }: { s: Instantanea; inicial: Partial<Cuenta>; onListo: () => void }) {
  const [d, setD] = useState({ ...inicial, saldoTxt: inicial.saldo_inicial ? String(inicial.saldo_inicial / 100) : "" });
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const esTarjeta = d.tipo === "tarjeta_credito";
  const tieneMovs = !!inicial.id && s.transacciones.some((t) => t.cuenta_id === inicial.id);
  const guardar = async () => {
    if (!d.nombre?.trim()) return setAviso({ tipo: "error", texto: "Poné un nombre" });
    const { saldoTxt, ...resto } = d;
    await guardarEntidad(db(), s, "cuentas", {
      ...resto, nombre: d.nombre.trim(), saldo_inicial: esTarjeta ? 0 : leerMonto(saldoTxt),
      compartida: esTarjeta && !!d.compartida, archivada: d.archivada ?? false,
    });
    onListo();
  };
  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre"><input value={d.nombre ?? ""} onChange={(e) => setD({ ...d, nombre: e.target.value })} className="campo" /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Tipo">
          <select value={d.tipo} disabled={tieneMovs} onChange={(e) => setD({ ...d, tipo: e.target.value as TipoCuenta })} className="campo">
            {Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Moneda">
          <select value={d.moneda} disabled={tieneMovs} onChange={(e) => setD({ ...d, moneda: e.target.value as "ARS" | "USD" })} className="campo">
            <option value="ARS">Pesos</option><option value="USD">Dólares</option>
          </select>
        </Campo>
      </div>
      {!esTarjeta && (
        <Campo etiqueta="Saldo inicial" ayuda="El saldo al empezar a usar la app. Después se mueve solo con los movimientos.">
          <EntradaMonto valor={d.saldoTxt} onChange={(v) => setD({ ...d, saldoTxt: v })} />
        </Campo>
      )}
      {esTarjeta && (
        <>
          <Interruptor etiqueta="La usamos para Negocio y Familia" activo={!!d.compartida} onChange={(v) => setD({ ...d, compartida: v })} />
          <Campo etiqueta="Día de vencimiento"><input type="number" min={1} max={31} value={d.dia_vencimiento ?? ""} onChange={(e) => setD({ ...d, dia_vencimiento: e.target.value ? Number(e.target.value) : null })} className="campo" /></Campo>
          <p className="text-xs text-suave">Si hoy la tarjeta ya tiene deuda, cargala en "Debemos" como deuda tipo tarjeta.</p>
        </>
      )}
      <Mensaje aviso={aviso} />
      <Boton className="w-full" onClick={guardar}>Guardar</Boton>
      {inicial.id && (
        <Boton variante="fantasma" className="w-full" onClick={async () => { await guardarEntidad(db(), s, "cuentas", { ...inicial, archivada: true }); onListo(); }}>
          Archivar (dejar de usarla)
        </Boton>
      )}
    </div>
  );
}

function FormPagoTarjeta({ s, t, onListo }: { s: Instantanea; t: TarjetaAmbito; onListo: () => void }) {
  const origenes = vivos(s.cuentas).filter((c) => c.ambito === t.ambito && c.tipo !== "tarjeta_credito" && c.moneda === "ARS" && !c.archivada);
  const [cuentaId, setCuentaId] = useState(origenes[0]?.id ?? "");
  const [monto, setMonto] = useState(String(t.deuda / 100));
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  return (
    <div className="space-y-3">
      <Campo etiqueta="Monto"><EntradaMonto valor={monto} onChange={setMonto} /></Campo>
      <Campo etiqueta="Desde">
        <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="campo">
          {origenes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {pesos(saldoCuenta(c, s.transacciones))}</option>)}
        </select>
      </Campo>
      <Mensaje aviso={aviso} />
      <Boton className="w-full" onClick={async () => {
        try { await pagarTarjeta(db(), s, { tarjetaId: t.cuenta.id, ambito: t.ambito, cuentaId, monto: leerMonto(monto) }); onListo(); }
        catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); }
      }}>Pagar</Boton>
    </div>
  );
}
