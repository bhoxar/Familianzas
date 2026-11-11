"use client";
/**
 * MÓDULO DE ASIGNACIÓN DE SUELDO (El Embudo)
 *
 * 1. Cuánto le debe el negocio a la familia este mes.
 * 2. "Pasar a Familia": confirma el pase REAL de plata (crea el sueldo, dos patas).
 * 3. La cascada de prioridades: se reordena con ▲▼ y muestra cuánto se llenó cada paso.
 * 4. Registrar un cobro: muestra ANTES de guardar cómo se va a repartir (forzado).
 */
import { useMemo, useState, type FormEvent } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { useHoy, useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import { confirmarSueldo, registrarMovimiento, reordenarReglas } from "@/lib/offline/repositorio";
import { estadoEmbudoMes, repartirIngreso, resumenSueldo, type PasoReparto } from "@/lib/dominio/embudo";
import { saldoCuenta, saldosSobres, type Instantanea } from "@/lib/dominio/calculos";
import { aCentavos, nombreMes, pesos } from "@/lib/dominio/utiles";
import { BarraProgreso, Boton, Tarjeta } from "./ui";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

export function ModuloSueldo() {
  const { ambito, cambiarAmbito } = useAmbito();
  const s = useInstantanea();
  const fecha = useHoy();
  const [aviso, setAviso] = useState<Aviso>(null);

  const calc = useMemo(() => {
    if (!s) return null;
    const estado = estadoEmbudoMes(s.reglas, s.distribuciones, fecha);
    const sobreSueldo = saldosSobres(s, fecha).find((x) => x.sobre.id === s.config?.sobre_sueldo_id);
    const resumen = resumenSueldo({
      estado,
      transacciones: s.transacciones,
      disponibleSobreSueldo: sobreSueldo?.disponible ?? 0,
      mes: fecha,
    });
    return { estado, resumen };
  }, [s, fecha]);

  if (ambito !== "empresa") {
    return (
      <Tarjeta titulo="Sueldo">
        <p>El sueldo sale del negocio. Cambiá a modo Negocio para gestionarlo.</p>
        <Boton className="mt-3 w-full" onClick={() => cambiarAmbito("empresa")}>Ver como Negocio</Boton>
      </Tarjeta>
    );
  }
  if (!s || !calc) return <div className="h-40 animate-pulse rounded-2xl bg-borde/60" />;

  const { estado, resumen } = calc;
  const avisar = (a: Aviso) => {
    setAviso(a);
    if (a?.tipo === "ok") setTimeout(() => setAviso(null), 6000);
  };

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Sueldo de {nombreMes(fecha)}</h1>

      {aviso && (
        <div role="status" className={`rounded-xl p-3 text-sm ${aviso.tipo === "ok" ? "bg-marca-suave text-marca" : "bg-rojo-suave text-rojo"}`}>
          {aviso.texto}
        </div>
      )}

      {/* 1. Resumen */}
      <Tarjeta>
        <p className="text-sm text-suave">El negocio todavía le debe a la familia</p>
        <p className={`cifra text-4xl font-bold ${resumen.deudaConFamilia > 0 ? "text-naranja" : "text-ok"}`}>
          {pesos(resumen.deudaConFamilia)}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <Dato etiqueta="Objetivo" valor={resumen.objetivo} />
          <Dato etiqueta="Apartado" valor={resumen.asignado} />
          <Dato etiqueta="Ya pasado" valor={resumen.transferido} />
        </dl>
      </Tarjeta>

      {/* 2. Pasar a familia */}
      <PasarAFamilia s={s} paraTransferir={resumen.paraTransferir} avisar={avisar} />

      {/* 3. Cascada */}
      <Cascada s={s} estado={estado} avisar={avisar} />

      {/* 4. Registrar cobro con vista previa del reparto */}
      <RegistrarCobro s={s} estado={estado} fecha={fecha} avisar={avisar} />
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="rounded-lg bg-fondo p-2">
      <dt className="text-suave">{etiqueta}</dt>
      <dd className="cifra mt-0.5 text-sm font-semibold">{pesos(valor)}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PasarAFamilia({ s, paraTransferir, avisar }: { s: Instantanea; paraTransferir: number; avisar: (a: Aviso) => void }) {
  const origenes = s.cuentas.filter((c) => c.ambito === "empresa" && c.tipo !== "tarjeta_credito" && c.moneda === s.hogar.moneda_base && !c.eliminado_en);
  const destinos = s.cuentas.filter((c) => c.ambito === "familia" && c.tipo !== "tarjeta_credito" && c.moneda === s.hogar.moneda_base && !c.eliminado_en);
  const [origen, setOrigen] = useState(origenes[0]?.id ?? "");
  const [destino, setDestino] = useState(s.config?.cuenta_familia_id ?? destinos[0]?.id ?? "");
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (paraTransferir <= 0) {
    return (
      <Tarjeta titulo="Para pasar a Familia">
        <p className="text-sm text-suave">No hay sueldo apartado pendiente de pasar. Se aparta solo con cada cobro.</p>
      </Tarjeta>
    );
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const centavos = monto ? aCentavos(monto) : paraTransferir;
      await confirmarSueldo(db(), s, { monto: centavos, cuentaEmpresaId: origen, cuentaFamiliaId: destino });
      setMonto("");
      avisar({ tipo: "ok", texto: `✓ Se registró el sueldo de ${pesos(centavos)}. Ya aparece en la Familia.` });
    } catch (err) {
      avisar({ tipo: "error", texto: (err as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta titulo="Para pasar a Familia" accion={<span className="cifra font-bold">{pesos(paraTransferir)}</span>}>
      <form onSubmit={enviar} className="space-y-3">
        <p className="text-sm text-suave">
          Esta plata ya está apartada: el negocio no la puede usar. Pasala a la cuenta familiar y confirmá.
        </p>
        <Campo etiqueta="Desde">
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="campo">
            {origenes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre} · {pesos(saldoCuenta(c, s.transacciones))}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Hacia">
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className="campo">
            {destinos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Monto (vacío = todo)">
          <input inputMode="decimal" placeholder={String(Math.round(paraTransferir / 100))} value={monto}
            onChange={(e) => setMonto(e.target.value)} className="campo cifra" />
        </Campo>
        <Boton type="submit" className="w-full" disabled={guardando}>Ya lo pasé ✓</Boton>
      </form>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
function Cascada({ s, estado, avisar }: { s: Instantanea; estado: ReturnType<typeof estadoEmbudoMes>; avisar: (a: Aviso) => void }) {
  const mover = async (indice: number, delta: -1 | 1) => {
    const ids = estado.map((e) => e.regla.id);
    const j = indice + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[indice], ids[j]] = [ids[j], ids[indice]];
    try {
      await reordenarReglas(db(), s.reglas, ids);
    } catch (err) {
      avisar({ tipo: "error", texto: (err as Error).message });
    }
  };

  return (
    <Tarjeta titulo="Cómo se reparte cada cobro">
      <p className="mb-3 text-sm text-suave">
        Cada peso que entra llena el primer paso hasta su tope y sigue con el siguiente. Subí lo más urgente.
      </p>
      <ol className="space-y-3">
        {estado.map(({ regla, cubierto, falta }, i) => {
          const esSueldo = regla.destino === "sueldo";
          return (
            <li key={regla.id} className={`rounded-xl border p-3 ${esSueldo ? "border-marca bg-marca-suave/50" : "border-borde"}`}>
              <div className="flex items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-marca text-xs font-bold text-white">{i + 1}</span>
                <span className="flex-1 font-semibold">{esSueldo ? "💰 " : ""}{regla.nombre}</span>
                <div className="flex flex-col">
                  <button aria-label={`Subir ${regla.nombre}`} disabled={i === 0} onClick={() => mover(i, -1)}
                    className="h-6 w-10 text-suave disabled:opacity-20">▲</button>
                  <button aria-label={`Bajar ${regla.nombre}`} disabled={i === estado.length - 1} onClick={() => mover(i, 1)}
                    className="h-6 w-10 text-suave disabled:opacity-20">▼</button>
                </div>
              </div>
              <div className="mt-2">
                <BarraProgreso valor={cubierto} total={regla.tope_mensual} etiqueta={`${regla.nombre}: lleno`} />
              </div>
              <p className="cifra mt-1 flex justify-between text-xs text-suave">
                <span>{pesos(cubierto)} de {pesos(regla.tope_mensual)}{regla.porcentaje_max ? ` · máx ${regla.porcentaje_max}% por cobro` : ""}</span>
                <span>{falta === 0 ? "✓ completo" : `faltan ${pesos(falta)}`}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
function RegistrarCobro({ s, estado, fecha, avisar }: {
  s: Instantanea; estado: ReturnType<typeof estadoEmbudoMes>; fecha: string; avisar: (a: Aviso) => void;
}) {
  const cuentas = s.cuentas.filter((c) => c.ambito === "empresa" && c.tipo !== "tarjeta_credito" && c.moneda === s.hogar.moneda_base && !c.eliminado_en);
  const [cuenta, setCuenta] = useState(cuentas[0]?.id ?? "");
  const [unidad, setUnidad] = useState(s.unidades[0]?.id ?? "");
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);

  let centavos = 0;
  try { centavos = monto ? aCentavos(monto) : 0; } catch { centavos = 0; }

  const vista = useMemo(() => {
    if (centavos <= 0) return null;
    try { return repartirIngreso({ monto: centavos, unidadId: unidad, estado }); } catch { return null; }
  }, [centavos, unidad, estado]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (centavos <= 0) return;
    setGuardando(true);
    try {
      const { embudo } = await registrarMovimiento(db(), s, {
        cuenta_id: cuenta, tipo: "ingreso", fecha, monto: centavos, unidad_negocio_id: unidad,
      });
      setMonto("");
      avisar({ tipo: "ok", texto: `✓ Cobro de ${pesos(centavos)} registrado. ${describirReparto(embudo?.pasos ?? [], embudo?.sobrante ?? 0)}` });
    } catch (err) {
      avisar({ tipo: "error", texto: (err as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta titulo="Registrar un cobro">
      <form onSubmit={enviar} className="space-y-3">
        <Campo etiqueta="Monto">
          <input inputMode="decimal" placeholder="$ 0" value={monto} onChange={(e) => setMonto(e.target.value)} className="campo cifra text-2xl" />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Negocio">
            <select value={unidad} onChange={(e) => setUnidad(e.target.value)} className="campo">
              {s.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Entró a">
            <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="campo">
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
        </div>

        {vista && (
          <div className="rounded-xl bg-fondo p-3 text-sm" aria-live="polite">
            <p className="mb-1 font-semibold">Así se va a repartir:</p>
            <ul className="space-y-1">
              {vista.pasos.map((p) => (
                <li key={p.regla.id} className="flex justify-between">
                  <span>{p.regla.destino === "sueldo" ? "💰 " : ""}{p.regla.nombre}</span>
                  <span className="cifra">{pesos(p.monto)}</span>
                </li>
              ))}
              {vista.sobrante > 0 && (
                <li className="flex justify-between text-suave">
                  <span>Queda sin destino</span><span className="cifra">{pesos(vista.sobrante)}</span>
                </li>
              )}
            </ul>
          </div>
        )}
        <Boton type="submit" className="w-full" disabled={guardando || centavos <= 0}>Registrar cobro</Boton>
        <p className="text-xs text-suave">Funciona sin señal: se guarda en el teléfono y se sube después.</p>
      </form>
    </Tarjeta>
  );
}

function describirReparto(pasos: PasoReparto[], sobrante: number): string {
  if (!pasos.length) return "Todos los pasos ya estaban completos: queda sin destino.";
  const partes = pasos.map((p) => `${pesos(p.monto)} a ${p.regla.nombre}`);
  if (sobrante > 0) partes.push(`${pesos(sobrante)} sin destino`);
  return `Se repartió: ${partes.join(" · ")}.`;
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-suave">{etiqueta}</span>
      {children}
    </label>
  );
}
