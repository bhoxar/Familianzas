"use client";
/**
 * ME DEBEN (cuentas por cobrar): clientes por semáforo, ficha con lo que
 * debe mes a mes, cobro (parcial o total), cuotas del mes, WhatsApp.
 */
import { useMemo, useState } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { useHoy, useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import {
  actualizarCargo, crearCargo, eliminarEntidad, generarCuotasMes, guardarEntidad, registrarCobroCliente,
} from "@/lib/offline/operaciones";
import { cuentasPorCobrar, type Instantanea, type Pendiente } from "@/lib/dominio/calculos";
import type { Deudor, Semaforo } from "@/lib/dominio/tipos";
import { idDeterminista, inicioDeMes, nombreMes, pesos, sumar, sumarDias, vivos } from "@/lib/dominio/utiles";
import { Boton, PuntoSemaforo, Tarjeta } from "@/components/ui";
import { Campo, EntradaMonto, Hoja, leerMonto, Mensaje } from "@/components/formulario";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

const GRUPOS: { clave: Semaforo; titulo: string }[] = [
  { clave: "critico", titulo: "🔴 Más de 60 días" },
  { clave: "moroso", titulo: "🟠 31 a 60 días" },
  { clave: "atrasado", titulo: "🟡 Hasta 30 días" },
  { clave: "gracia", titulo: "🟡 En días de gracia" },
  { clave: "al_dia", titulo: "🟢 Todavía no vence" },
];
const PESO: Record<Semaforo, number> = { al_dia: 0, gracia: 1, atrasado: 2, moroso: 3, critico: 4 };

function linkWhatsApp(d: Deudor, saldo: number) {
  if (!d.telefono) return null;
  const tel = d.telefono.replace(/\D/g, "");
  const texto = `Hola ${d.nombre.split(" ")[0]}, ¿cómo estás? Te recuerdo el saldo pendiente de ${pesos(saldo)}. ¡Muchas gracias!`;
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}

export default function MeDeben() {
  const { ambito, cambiarAmbito } = useAmbito();
  const s = useInstantanea();
  const fecha = useHoy();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<Deudor> | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);

  const datos = useMemo(() => {
    if (!s) return null;
    const pendientes = cuentasPorCobrar(s, fecha);
    const porCliente = new Map<string, { deudor: Deudor; pendientes: Pendiente[]; saldo: number; semaforo: Semaforo; dias: number }>();
    for (const d of vivos(s.deudores)) porCliente.set(d.id, { deudor: d, pendientes: [], saldo: 0, semaforo: "al_dia", dias: 0 });
    for (const p of pendientes) {
      const c = porCliente.get(p.deudor.id);
      if (!c) continue;
      c.pendientes.push(p);
      c.saldo += p.saldo;
      c.dias = Math.max(c.dias, p.diasAtraso);
      if (PESO[p.semaforo] > PESO[c.semaforo]) c.semaforo = p.semaforo;
    }
    const mes = inicioDeMes(fecha);
    const faltanCuotas = vivos(s.deudores).filter((d) => d.activo && d.tarifa_mensual && !s.cargos.some((c) => c.id === idDeterminista("cuota", d.id, mes))).length;
    return { clientes: [...porCliente.values()], total: sumar(pendientes.map((p) => p.saldo)), faltanCuotas };
  }, [s, fecha]);

  if (ambito !== "empresa") {
    return (
      <Tarjeta titulo="Me deben">
        <p>Lo que deben los clientes es del negocio.</p>
        <Boton className="mt-3 w-full" onClick={() => cambiarAmbito("empresa")}>Ver como Negocio</Boton>
      </Tarjeta>
    );
  }
  if (!s || !datos) return null;

  const generar = async () => {
    const nuevas = await generarCuotasMes(db(), s, fecha);
    setAviso({ tipo: "ok", texto: nuevas.length ? `Se generaron ${nuevas.length} cuotas de ${nombreMes(fecha)}.` : "Las cuotas del mes ya estaban generadas." });
  };
  const cliente = datos.clientes.find((c) => c.deudor.id === abierto);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-bold">Me deben</h1>
          <p className="cifra text-3xl font-bold">{pesos(datos.total)}</p>
        </div>
        <Boton variante="secundario" onClick={() => setEditando({ dias_gracia: 5, activo: true, cantidad_unidades: 1, dia_vencimiento: 10 })}>+ Cliente</Boton>
      </div>
      <Mensaje aviso={aviso} />
      {datos.faltanCuotas > 0 && (
        <Boton className="w-full" onClick={generar}>Generar cuotas de {nombreMes(fecha)} ({datos.faltanCuotas})</Boton>
      )}

      {GRUPOS.map((g) => {
        const lista = datos.clientes.filter((c) => c.saldo > 0 && c.semaforo === g.clave).sort((a, b) => b.dias - a.dias);
        if (!lista.length) return null;
        return (
          <Tarjeta key={g.clave} titulo={g.titulo}>
            <ul className="divide-y divide-borde">
              {lista.map((c) => <FilaCliente key={c.deudor.id} c={c} onAbrir={() => setAbierto(c.deudor.id)} />)}
            </ul>
          </Tarjeta>
        );
      })}

      {datos.clientes.some((c) => c.saldo === 0) && (
        <Tarjeta titulo="✓ Al día, sin deuda">
          <ul className="divide-y divide-borde">
            {datos.clientes.filter((c) => c.saldo === 0).map((c) => <FilaCliente key={c.deudor.id} c={c} onAbrir={() => setAbierto(c.deudor.id)} />)}
          </ul>
        </Tarjeta>
      )}
      {datos.clientes.length === 0 && <p className="text-center text-suave">Todavía no hay clientes. Agregalos con “+ Cliente”.</p>}

      <Hoja abierta={!!cliente} onCerrar={() => setAbierto(null)} titulo={cliente?.deudor.nombre ?? ""}>
        {cliente && (
          <FichaCliente s={s} c={cliente} fecha={fecha} onEditar={() => { setEditando(cliente.deudor); setAbierto(null); }} />
        )}
      </Hoja>
      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo={editando?.id ? "Editar cliente" : "Nuevo cliente"}>
        {editando && <FormCliente s={s} inicial={editando} onListo={() => setEditando(null)} />}
      </Hoja>
    </div>
  );
}

function FilaCliente({ c, onAbrir }: { c: { deudor: Deudor; saldo: number; semaforo: Semaforo; dias: number }; onAbrir: () => void }) {
  const wa = c.saldo > 0 ? linkWhatsApp(c.deudor, c.saldo) : null;
  return (
    <li className="flex items-center gap-3 py-2">
      <button onClick={onAbrir} className="flex min-h-12 flex-1 items-center gap-3 text-left">
        <PuntoSemaforo estado={c.semaforo} />
        <span className="flex-1">
          <span className="block font-medium">{c.deudor.nombre}</span>
          {c.saldo > 0 && c.dias > 0 && <span className="text-xs text-suave">{c.dias} {c.dias === 1 ? "día" : "días"} de atraso</span>}
        </span>
        <span className="cifra font-semibold">{pesos(c.saldo)}</span>
      </button>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" aria-label={`Recordar a ${c.deudor.nombre} por WhatsApp`}
          className="grid size-11 place-items-center rounded-full bg-marca-suave">💬</a>
      )}
    </li>
  );
}

function FichaCliente({ s, c, fecha, onEditar }: {
  s: Instantanea; c: { deudor: Deudor; pendientes: Pendiente[]; saldo: number }; fecha: string; onEditar: () => void;
}) {
  const cuentas = vivos(s.cuentas).filter((x) => x.ambito === "empresa" && x.tipo !== "tarjeta_credito" && !x.archivada);
  const [monto, setMonto] = useState("");
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [cargo, setCargo] = useState({ concepto: "", monto: "", vence: sumarDias(fecha, 10) });
  const [aviso, setAviso] = useState<Aviso>(null);
  const unidad = s.unidades.find((u) => u.id === c.deudor.unidad_negocio_id);
  const pagos = s.cobros.filter((x) => s.cargos.find((g) => g.id === x.cargo_id)?.deudor_id === c.deudor.id);

  const cobrar = async () => {
    try {
      const valor = leerMonto(monto) || c.saldo;
      const r = await registrarCobroCliente(db(), s, { deudorId: c.deudor.id, monto: valor, cuentaId, fecha });
      setMonto("");
      setAviso({ tipo: "ok", texto: `Cobro de ${pesos(valor)} registrado.${r.aFavor > 0 ? ` Quedan ${pesos(r.aFavor)} a favor del cliente.` : ""}` });
    } catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); }
  };
  const nuevoCargo = async () => {
    try {
      await crearCargo(db(), s, { deudorId: c.deudor.id, concepto: cargo.concepto, monto: leerMonto(cargo.monto), vencimiento: cargo.vence });
      setCargo({ concepto: "", monto: "", vence: sumarDias(fecha, 10) });
      setAviso({ tipo: "ok", texto: "Deuda agregada." });
    } catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-suave">
        {unidad?.nombre}{c.deudor.tarifa_mensual ? ` · ${pesos(c.deudor.tarifa_mensual)} × ${c.deudor.cantidad_unidades ?? 1} por mes` : ""}
        {c.deudor.telefono ? ` · ${c.deudor.telefono}` : ""}
        {" · "}<button onClick={onEditar} className="font-semibold text-marca">Editar</button>
      </p>
      <Mensaje aviso={aviso} />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-suave">Debe · <span className="cifra">{pesos(c.saldo)}</span></h3>
        {c.pendientes.length === 0 ? <p className="text-sm text-suave">No debe nada.</p> : (
          <ul className="space-y-2">
            {c.pendientes.map((p) => (
              <li key={p.cargo.id} className="rounded-xl border border-borde p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span><PuntoSemaforo estado={p.semaforo} /> {p.cargo.concepto}</span>
                  <span className="cifra font-semibold">{pesos(p.saldo)}</span>
                </div>
                <p className="mt-1 text-xs text-suave">
                  Venció {p.cargo.fecha_vencimiento.split("-").reverse().join("/")}{p.pagado > 0 ? ` · pagó ${pesos(p.pagado)}` : ""}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-suave">
                    ¿Va a pagar?
                    <select value={p.cargo.probabilidad_cobro} onChange={(e) => actualizarCargo(db(), p.cargo, { probabilidad_cobro: Number(e.target.value) })} className="rounded-lg border border-borde bg-superficie p-1">
                      <option value={100}>Seguro</option><option value={50}>Quizás</option><option value={0}>Difícil</option>
                    </select>
                  </label>
                  <button className="ml-auto text-xs font-semibold text-rojo"
                    onClick={() => confirm("¿Marcar como incobrable? Deja de contar como plata esperada.") && actualizarCargo(db(), p.cargo, { estado: "incobrable" })}>
                    Incobrable
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {c.saldo > 0 && (
        <section className="space-y-2 rounded-xl bg-fondo p-3">
          <h3 className="text-xs font-semibold uppercase text-suave">Registrar cobro</h3>
          <EntradaMonto etiqueta="Monto cobrado" valor={monto} onChange={setMonto} placeholder={`${pesos(c.saldo)} (todo)`} />
          <select aria-label="Entró a" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="campo">
            {cuentas.map((x) => <option key={x.id} value={x.id}>{x.moneda === "USD" ? "💵 " : ""}{x.nombre}</option>)}
          </select>
          <Boton className="w-full" onClick={cobrar}>Cobrar</Boton>
          <p className="text-xs text-suave">Se descuenta primero lo más viejo. Si es parcial, el resto sigue pendiente.</p>
        </section>
      )}

      <details className="rounded-xl border border-borde p-3">
        <summary className="text-sm font-semibold">+ Agregar deuda (venta fiada, reserva, servicio)</summary>
        <div className="mt-3 space-y-2">
          <input aria-label="Concepto" placeholder="Ej: 10 bolsas de alimento" value={cargo.concepto} onChange={(e) => setCargo({ ...cargo, concepto: e.target.value })} className="campo" />
          <div className="grid grid-cols-2 gap-2">
            <EntradaMonto etiqueta="Monto" valor={cargo.monto} onChange={(v) => setCargo({ ...cargo, monto: v })} />
            <input aria-label="Vence" type="date" value={cargo.vence} onChange={(e) => setCargo({ ...cargo, vence: e.target.value })} className="campo" />
          </div>
          <Boton variante="secundario" className="w-full" onClick={nuevoCargo}>Agregar</Boton>
        </div>
      </details>

      {pagos.length > 0 && (
        <p className="text-xs text-suave">Pagos registrados: {pagos.length} · total {pesos(sumar(pagos.map((x) => x.monto)))}</p>
      )}
    </div>
  );
}

function FormCliente({ s, inicial, onListo }: { s: Instantanea; inicial: Partial<Deudor>; onListo: () => void }) {
  const unidades = vivos(s.unidades);
  const [d, setD] = useState({
    ...inicial,
    unidad_negocio_id: inicial.unidad_negocio_id ?? unidades[0]?.id,
    tarifaTxt: inicial.tarifa_mensual ? String(inicial.tarifa_mensual / 100) : "",
  });
  const [aviso, setAviso] = useState<Aviso>(null);
  const guardar = async () => {
    if (!d.nombre?.trim() || !d.unidad_negocio_id) return setAviso({ tipo: "error", texto: "Completá nombre y negocio" });
    const { tarifaTxt, ...resto } = d;
    await guardarEntidad(db(), s, "deudores", {
      ...resto, nombre: d.nombre.trim(), tarifa_mensual: leerMonto(tarifaTxt) || null,
      dias_gracia: d.dias_gracia ?? 5, activo: d.activo ?? true,
    });
    onListo();
  };
  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre"><input value={d.nombre ?? ""} onChange={(e) => setD({ ...d, nombre: e.target.value })} className="campo" /></Campo>
      <Campo etiqueta="Negocio">
        <select value={d.unidad_negocio_id} onChange={(e) => setD({ ...d, unidad_negocio_id: e.target.value })} className="campo">
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="WhatsApp" ayuda="Con código de país, ej: 5491112345678">
        <input inputMode="tel" value={d.telefono ?? ""} onChange={(e) => setD({ ...d, telefono: e.target.value })} className="campo" />
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Cuota mensual (por unidad)"><EntradaMonto valor={d.tarifaTxt} onChange={(v) => setD({ ...d, tarifaTxt: v })} /></Campo>
        <Campo etiqueta="Caballos / unidades">
          <input type="number" min={1} value={d.cantidad_unidades ?? 1} onChange={(e) => setD({ ...d, cantidad_unidades: Number(e.target.value) })} className="campo" />
        </Campo>
        <Campo etiqueta="Día que vence">
          <input type="number" min={1} max={28} value={d.dia_vencimiento ?? 10} onChange={(e) => setD({ ...d, dia_vencimiento: Number(e.target.value) })} className="campo" />
        </Campo>
        <Campo etiqueta="Días de gracia">
          <input type="number" min={0} max={30} value={d.dias_gracia ?? 5} onChange={(e) => setD({ ...d, dias_gracia: Number(e.target.value) })} className="campo" />
        </Campo>
      </div>
      <Mensaje aviso={aviso} />
      <Boton className="w-full" onClick={guardar}>Guardar</Boton>
      {inicial.id && (
        <Boton variante="fantasma" className="w-full text-rojo"
          onClick={async () => { if (confirm("¿Dar de baja este cliente?")) { await eliminarEntidad(db(), "deudores", inicial as Deudor); onListo(); } }}>
          Dar de baja
        </Boton>
      )}
    </div>
  );
}
