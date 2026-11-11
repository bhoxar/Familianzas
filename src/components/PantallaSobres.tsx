"use client";
/**
 * SOBRES (presupuesto base cero). Misma pantalla para Negocio y Familia:
 * muestra solo los sobres del modo actual.
 */
import { useMemo, useState } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { useHoy, useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import {
  aplicarReparto, asignarASobre, eliminarEntidad, guardarEntidad, moverEntreSobres, propuestaRepartoAuto,
} from "@/lib/offline/operaciones";
import { plataSinDestino, saldosSobres, type Instantanea, type SaldoSobre } from "@/lib/dominio/calculos";
import type { Sobre, TipoSobre } from "@/lib/dominio/tipos";
import { pesos, vivos } from "@/lib/dominio/utiles";
import type { PropuestaReparto } from "@/lib/dominio/presupuesto";
import { BarraProgreso, Boton, Tarjeta } from "./ui";
import { Campo, EntradaMonto, Hoja, leerMonto, Mensaje } from "./formulario";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

const TIPOS: { valor: TipoSobre; texto: string }[] = [
  { valor: "gasto_mensual", texto: "Gasto del mes" },
  { valor: "costo_fijo", texto: "Costo fijo" },
  { valor: "deuda", texto: "Cuotas / deudas" },
  { valor: "fondo_emergencia", texto: "Fondo de emergencia" },
  { valor: "ahorro", texto: "Ahorro" },
  { valor: "inversion", texto: "Inversión" },
  { valor: "impuestos", texto: "Impuestos" },
];

export function PantallaSobres() {
  const { ambito } = useAmbito();
  const s = useInstantanea();
  const fecha = useHoy();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<Sobre> | null>(null);
  const [propuesta, setPropuesta] = useState<PropuestaReparto[] | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);

  const datos = useMemo(() => {
    if (!s) return null;
    const saldos = saldosSobres(s, fecha).filter((x) => x.sobre.ambito === ambito);
    const grupos = new Map<string, SaldoSobre[]>();
    for (const x of saldos.sort((a, b) => a.sobre.prioridad - b.sobre.prioridad || a.sobre.orden - b.sobre.orden)) {
      const g = x.sobre.grupo || (x.sobre.tipo === "sueldo" ? "Sueldo" : "Otros");
      grupos.set(g, [...(grupos.get(g) ?? []), x]);
    }
    return { libre: plataSinDestino(s, ambito, fecha).monto, grupos: [...grupos.entries()], saldos };
  }, [s, ambito, fecha]);

  if (!s || !datos) return null;
  const sel = datos.saldos.find((x) => x.sobre.id === abierto);

  const repartir = () => {
    const p = propuestaRepartoAuto(s, ambito, fecha);
    if (!p.length) setAviso({ tipo: "error", texto: "Ningún sobre tiene una necesidad mensual pendiente. Configurala tocando cada sobre." });
    else setPropuesta(p);
  };

  return (
    <div className="space-y-3">
      <Tarjeta titulo="Plata sin destino">
        <p className={`cifra text-3xl font-bold ${datos.libre < 0 ? "text-rojo" : "text-marca"}`}>{pesos(datos.libre)}</p>
        <p className="mt-1 text-sm text-suave">
          {datos.libre > 0 ? "Dale un trabajo a cada peso: repartila en los sobres." : datos.libre < 0 ? "Hay más asignado o gastado que plata real. Sacá de algún sobre." : "Todo repartido. 👌"}
        </p>
        {datos.libre > 0 && <Boton className="mt-3 w-full" onClick={repartir}>Repartir automáticamente</Boton>}
      </Tarjeta>
      <Mensaje aviso={aviso} />

      {datos.grupos.map(([grupo, lista]) => (
        <Tarjeta key={grupo} titulo={grupo}>
          <ul className="space-y-3">
            {lista.map((x) => (
              <li key={x.sobre.id}>
                <button onClick={() => setAbierto(x.sobre.id)} className="w-full text-left">
                  <div className="mb-1 flex justify-between gap-2">
                    <span className="font-medium">{x.sobre.nombre}</span>
                    <span className={`cifra font-bold ${x.disponible < 0 ? "text-rojo" : ""}`}>{pesos(x.disponible)}</span>
                  </div>
                  <BarraProgreso
                    valor={Math.max(x.disponible, 0)}
                    total={Math.max(x.asignadoMes, x.sobre.meta_mensual ?? 0, x.sobre.meta_monto ?? 0, x.disponible, 1)}
                    etiqueta={`Disponible en ${x.sobre.nombre}`}
                    tono={x.disponible < 0 ? "rojo" : "marca"}
                  />
                  <p className="mt-1 text-xs text-suave">
                    {x.actividadMes < 0 ? `Gastado este mes: ${pesos(-x.actividadMes)}` : "Sin gastos este mes"}
                    {x.sobre.meta_mensual ? ` · necesita ${pesos(x.sobre.meta_mensual)}/mes` : ""}
                    {x.sobre.meta_monto ? ` · meta ${pesos(x.sobre.meta_monto)}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ))}
      <Boton variante="secundario" className="w-full" onClick={() => setEditando({ ambito, tipo: "gasto_mensual", prioridad: 20, orden: 0 })}>+ Nuevo sobre</Boton>

      <Hoja abierta={!!sel} onCerrar={() => setAbierto(null)} titulo={sel?.sobre.nombre ?? ""}>
        {sel && <DetalleSobre s={s} x={sel} libre={datos.libre} fecha={fecha} otros={datos.saldos.filter((o) => o.sobre.id !== sel.sobre.id && o.sobre.tipo !== "sueldo")}
          onEditar={() => { setEditando(sel.sobre); setAbierto(null); }} />}
      </Hoja>
      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo={editando?.id ? "Editar sobre" : "Nuevo sobre"}>
        {editando && <FormSobre s={s} inicial={editando} onListo={() => setEditando(null)} />}
      </Hoja>
      <Hoja abierta={!!propuesta} onCerrar={() => setPropuesta(null)} titulo="Reparto sugerido">
        {propuesta && (
          <div className="space-y-3">
            <p className="text-sm text-suave">Por orden de prioridad, con la plata que hay hoy:</p>
            <ul className="divide-y divide-borde">
              {propuesta.map((p) => (
                <li key={p.sobre.id} className="flex justify-between py-2">
                  <span>{p.sobre.nombre}<span className="block text-xs text-suave">{p.motivo}</span></span>
                  <span className="cifra font-semibold">{pesos(p.monto)}</span>
                </li>
              ))}
            </ul>
            <Boton className="w-full" onClick={async () => {
              try { await aplicarReparto(db(), s, propuesta, fecha); setPropuesta(null); setAviso({ tipo: "ok", texto: "Plata repartida en los sobres." }); }
              catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); setPropuesta(null); }
            }}>Repartir así</Boton>
          </div>
        )}
      </Hoja>
    </div>
  );
}

function DetalleSobre({ s, x, libre, fecha, otros, onEditar }: {
  s: Instantanea; x: SaldoSobre; libre: number; fecha: string; otros: SaldoSobre[]; onEditar: () => void;
}) {
  const [monto, setMonto] = useState("");
  const [destino, setDestino] = useState(otros[0]?.sobre.id ?? "");
  const [aviso, setAviso] = useState<Aviso>(null);
  const valor = leerMonto(monto);
  const esSueldo = x.sobre.tipo === "sueldo";
  const movs = s.transacciones.filter((t) => t.sobre_id === x.sobre.id && !t.eliminado_en).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 8);

  const accion = async (f: () => Promise<unknown>, texto: string) => {
    try { await f(); setMonto(""); setAviso({ tipo: "ok", texto }); } catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); }
  };

  return (
    <div className="space-y-4">
      <p className={`cifra text-3xl font-bold ${x.disponible < 0 ? "text-rojo" : ""}`}>{pesos(x.disponible)}</p>
      <Mensaje aviso={aviso} />
      {esSueldo ? (
        <p className="text-sm text-suave">Este sobre lo llena el Embudo con cada cobro. Se vacía al pasar el sueldo a la familia (pantalla Sueldo).</p>
      ) : (
        <div className="space-y-2 rounded-xl bg-fondo p-3">
          <EntradaMonto etiqueta="Monto" valor={monto} onChange={setMonto} placeholder={`$ 0 · sin destino: ${pesos(Math.max(libre, 0))}`} />
          <div className="grid grid-cols-2 gap-2">
            <Boton disabled={!valor} onClick={() => accion(() => asignarASobre(db(), s, x.sobre.id, valor, fecha), `Se agregaron ${pesos(valor)}.`)}>+ Agregar</Boton>
            <Boton variante="secundario" disabled={!valor} onClick={() => accion(() => asignarASobre(db(), s, x.sobre.id, -valor, fecha), `Se sacaron ${pesos(valor)}: vuelven a sin destino.`)}>− Sacar</Boton>
          </div>
          {otros.length > 0 && (
            <div className="flex gap-2">
              <select aria-label="Mover a" value={destino} onChange={(e) => setDestino(e.target.value)} className="campo flex-1">
                {otros.map((o) => <option key={o.sobre.id} value={o.sobre.id}>{o.sobre.nombre}</option>)}
              </select>
              <Boton variante="secundario" disabled={!valor} onClick={() => accion(() => moverEntreSobres(db(), s, x.sobre.id, destino, valor, fecha), "Plata movida.")}>Mover</Boton>
            </div>
          )}
        </div>
      )}
      {movs.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase text-suave">Últimos movimientos</h3>
          <ul className="divide-y divide-borde text-sm">
            {movs.map((t) => (
              <li key={t.id} className="flex justify-between py-1.5">
                <span>{t.descripcion || t.tipo}<span className="block text-xs text-suave">{t.fecha.split("-").reverse().join("/")}</span></span>
                <span className="cifra">{pesos(t.monto)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Boton variante="fantasma" className="w-full" onClick={onEditar}>Editar sobre</Boton>
    </div>
  );
}

function FormSobre({ s, inicial, onListo }: { s: Instantanea; inicial: Partial<Sobre>; onListo: () => void }) {
  const [d, setD] = useState({
    ...inicial,
    necesidad: inicial.meta_mensual ? String(inicial.meta_mensual / 100) : "",
    meta: inicial.meta_monto ? String(inicial.meta_monto / 100) : "",
  });
  const [aviso, setAviso] = useState<Aviso>(null);
  const unidades = vivos(s.unidades);
  const guardar = async () => {
    if (!d.nombre?.trim()) return setAviso({ tipo: "error", texto: "Poné un nombre" });
    const { necesidad, meta, ...resto } = d;
    await guardarEntidad(db(), s, "sobres", {
      ...resto, nombre: d.nombre.trim(), meta_mensual: leerMonto(necesidad) || null, meta_monto: leerMonto(meta) || null,
      prioridad: d.prioridad ?? 20, orden: d.orden ?? 0,
    });
    onListo();
  };
  const esSueldo = inicial.tipo === "sueldo";
  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre"><input value={d.nombre ?? ""} onChange={(e) => setD({ ...d, nombre: e.target.value })} className="campo" /></Campo>
      {!esSueldo && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Tipo">
              <select value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as TipoSobre })} className="campo">
                {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Grupo"><input value={d.grupo ?? ""} placeholder="Ej: Hijos" onChange={(e) => setD({ ...d, grupo: e.target.value })} className="campo" /></Campo>
            <Campo etiqueta="Necesita por mes"><EntradaMonto valor={d.necesidad} onChange={(v) => setD({ ...d, necesidad: v })} /></Campo>
            <Campo etiqueta="Meta total (opcional)"><EntradaMonto valor={d.meta} onChange={(v) => setD({ ...d, meta: v })} /></Campo>
          </div>
          <Campo etiqueta="Prioridad" ayuda="1 = se llena primero al repartir.">
            <input type="number" min={1} max={999} value={d.prioridad ?? 20} onChange={(e) => setD({ ...d, prioridad: Number(e.target.value) })} className="campo" />
          </Campo>
          {d.ambito === "empresa" && (
            <Campo etiqueta="Negocio (opcional)">
              <select value={d.unidad_negocio_id ?? ""} onChange={(e) => setD({ ...d, unidad_negocio_id: e.target.value || null })} className="campo">
                <option value="">Todos</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </Campo>
          )}
        </>
      )}
      <Mensaje aviso={aviso} />
      <Boton className="w-full" onClick={guardar}>Guardar</Boton>
      {inicial.id && !esSueldo && (
        <Boton variante="fantasma" className="w-full text-rojo" onClick={async () => {
          if (confirm("¿Borrar el sobre? Lo que tenga vuelve a plata sin destino.")) { await eliminarEntidad(db(), "sobres", inicial as Sobre); onListo(); }
        }}>Borrar sobre</Boton>
      )}
    </div>
  );
}
