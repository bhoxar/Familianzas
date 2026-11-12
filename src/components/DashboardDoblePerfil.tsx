"use client";
/**
 * DASHBOARD DE DOBLE PERFIL
 *
 * Un solo componente, dos mundos que no se tocan:
 *  - lee el ámbito del interruptor global,
 *  - pide a `armarDashboard` SOLO los datos de ese ámbito,
 *  - muestra como máximo 4 tarjetas y UNA alerta (la más urgente).
 *
 * Funciona sin señal: todo se calcula con los datos guardados en el teléfono.
 */
import Link from "next/link";
import { useMemo } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { useInstantanea, useHoy } from "@/lib/estado/datos";
import { armarDashboard, type Alerta, type DashboardFamilia, type DashboardNegocio } from "@/lib/dominio/dashboard";
import { dolares, hoy, nombreMes, pesos } from "@/lib/dominio/utiles";
import { BarraProgreso, PuntoSemaforo, Tarjeta } from "./ui";

export function DashboardDoblePerfil() {
  const { ambito, unidadId } = useAmbito();
  const s = useInstantanea();
  const fecha = useHoy();
  const datos = useMemo(() => (s ? armarDashboard(s, ambito, fecha, unidadId) : null), [s, ambito, fecha, unidadId]);

  if (s === undefined) return <Esqueleto />;
  if (s === null || !datos) {
    return <p className="mt-10 text-center text-suave">Todavía no hay un hogar configurado en este teléfono.</p>;
  }

  return (
    <div className="space-y-3" aria-live="polite">
      <h1 className="sr-only">{ambito === "empresa" ? "Inicio del Negocio" : "Inicio de la Familia"}</h1>
      {datos.ambito === "empresa" ? (
        <InicioNegocio d={datos} unidades={s.unidades.filter((u) => u.activa)} />
      ) : (
        <InicioFamilia d={datos} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerta única
// ---------------------------------------------------------------------------
function AlertaPrincipal({ alerta }: { alerta: Alerta | null }) {
  if (!alerta) return null;
  const rojo = alerta.nivel === "rojo";
  return (
    <div
      role="alert"
      className={`rounded-2xl border-l-4 p-4 ${rojo ? "border-rojo bg-rojo-suave" : "border-naranja bg-naranja-suave"}`}
    >
      <p className={`font-bold ${rojo ? "text-rojo" : "text-naranja"}`}>⚠ {alerta.titulo}</p>
      <p className="mt-1 text-sm">{alerta.detalle}</p>
      {alerta.accion && (
        <Link href={alerta.accion.href} className="mt-2 inline-block text-sm font-semibold text-marca underline">
          {alerta.accion.texto} ›
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modo NEGOCIO
// ---------------------------------------------------------------------------
function FiltroUnidades({ unidades }: { unidades: { id: string; nombre: string }[] }) {
  const { unidadId, filtrarUnidad } = useAmbito();
  const opciones = [{ id: null as string | null, nombre: "Todos" }, ...unidades];
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Filtrar por negocio">
      {opciones.map((u) => (
        <button
          key={u.id ?? "todos"}
          role="tab"
          aria-selected={unidadId === u.id}
          onClick={() => filtrarUnidad(u.id)}
          className={`min-h-9 shrink-0 rounded-full border px-3 text-sm ${
            unidadId === u.id ? "border-marca bg-marca text-white" : "border-borde bg-superficie text-suave"
          }`}
        >
          {u.nombre}
        </button>
      ))}
    </div>
  );
}

function InicioNegocio({ d, unidades }: { d: DashboardNegocio; unidades: { id: string; nombre: string }[] }) {
  const { flujo, sueldo, meDeben } = d;
  const maxFlujo = Math.max(flujo.cobrado + flujo.esperado, flujo.gastado, 1);
  const mes = nombreMes(hoy());

  return (
    <>
      <FiltroUnidades unidades={unidades} />
      <AlertaPrincipal alerta={d.alerta} />

      {/* 1. Esperado vs real */}
      <Tarjeta titulo={`Este mes · ${mes}`}>
        <dl className="space-y-3">
          <FilaFlujo etiqueta="Cobrado" monto={flujo.cobrado} total={maxFlujo} tono="marca" />
          <FilaFlujo etiqueta="Esperado (todavía no entró)" monto={flujo.esperado} total={maxFlujo} tono="gris" atenuado />
          <FilaFlujo etiqueta="Gastado" monto={flujo.gastado} total={maxFlujo} tono="naranja" />
        </dl>
        <p className="mt-3 border-t border-borde pt-3 text-sm">
          Plata sin destino:{" "}
          <strong className={`cifra ${d.plataSinDestino < 0 ? "text-rojo" : ""}`}>{pesos(d.plataSinDestino)}</strong>
        </p>
      </Tarjeta>

      {/* 2. Sueldo de la familia */}
      <Tarjeta titulo="Sueldo de la familia" accion={<Link href="/negocio/sueldo" className="text-sm font-semibold text-marca">Ver ›</Link>}>
        <p className="cifra text-2xl font-bold">
          {pesos(sueldo.transferido)} <span className="text-base font-normal text-suave">de {pesos(sueldo.objetivo)}</span>
        </p>
        <div className="mt-2">
          <BarraProgreso valor={sueldo.transferido} total={sueldo.objetivo} etiqueta="Sueldo pasado a la familia" />
        </div>
        {sueldo.minimo && sueldo.minimo.cubierto < sueldo.minimo.tope && (
          <p className="mt-2 text-sm text-naranja">
            Sueldo mínimo: faltan {pesos(sueldo.minimo.tope - sueldo.minimo.cubierto)}
          </p>
        )}
        {sueldo.paraTransferir > 0 && (
          <Link
            href="/negocio/sueldo"
            className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-marca px-4 font-semibold text-white"
          >
            Pasar {pesos(sueldo.paraTransferir)} a Familia ➜
          </Link>
        )}
      </Tarjeta>

      {/* 3. Me deben */}
      <Tarjeta
        titulo={`Me deben · ${meDeben.clientes} cliente${meDeben.clientes === 1 ? "" : "s"}`}
        accion={<span className="cifra text-base font-bold">{pesos(meDeben.total)}</span>}
      >
        {meDeben.top.length === 0 ? (
          <p className="text-sm text-suave">Nadie atrasado. 👏</p>
        ) : (
          <ul className="divide-y divide-borde">
            {meDeben.top.map((m) => (
              <li key={m.deudorId} className="flex items-center gap-3 py-2">
                <PuntoSemaforo estado={m.semaforo} />
                <span className="flex-1 truncate">{m.nombre}</span>
                <span className="cifra text-sm">{pesos(m.saldo)}</span>
                <span className="w-14 text-right text-xs text-suave">{m.diasAtraso} {m.diasAtraso === 1 ? "día" : "días"}</span>
                {m.telefono && (
                  <a
                    href={`https://wa.me/${m.telefono}?text=${encodeURIComponent(
                      `Hola ${m.nombre.split(" ")[0]}, te recuerdo el saldo pendiente de ${pesos(m.saldo)}. ¡Gracias!`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Recordar a ${m.nombre} por WhatsApp`}
                    className="grid size-10 place-items-center rounded-full bg-marca-suave"
                  >
                    💬
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {/* 4. Dólares (solo si hay) */}
      {d.dolaresSinConvertir > 0 && (
        <Tarjeta titulo="Dólares sin convertir">
          <p className="cifra text-xl font-bold">
            {dolares(d.dolaresSinConvertir)}
            {d.cotizacion && (
              <span className="ml-2 text-base font-normal text-suave">
                ≈ {pesos(Math.round(d.dolaresSinConvertir * d.cotizacion.promedio))}
              </span>
            )}
          </p>
          {d.cotizacion && (
            <p className="mt-1 text-xs text-suave">
              Blue promedio {pesos(d.cotizacion.promedio * 100)} · {d.cotizacion.fecha.slice(8)}/{d.cotizacion.fecha.slice(5, 7)}.
              No se reparten en sobres hasta convertirlos.
            </p>
          )}
        </Tarjeta>
      )}
    </>
  );
}

function FilaFlujo({ etiqueta, monto, total, tono, atenuado }: {
  etiqueta: string; monto: number; total: number; tono: "marca" | "gris" | "naranja"; atenuado?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <dt className={atenuado ? "text-suave" : ""}>{etiqueta}</dt>
        <dd className={`cifra font-semibold ${atenuado ? "text-suave" : ""}`}>{pesos(monto)}</dd>
      </div>
      <BarraProgreso valor={monto} total={total} etiqueta={etiqueta} tono={tono} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modo FAMILIA
// ---------------------------------------------------------------------------
function InicioFamilia({ d }: { d: DashboardFamilia }) {
  return (
    <>
      <AlertaPrincipal alerta={d.alerta} />

      {/* 1. Plata sin destino */}
      <Tarjeta titulo="Plata sin destino">
        <p className={`cifra text-4xl font-bold ${d.plataSinDestino < 0 ? "text-rojo" : "text-marca"}`}>{pesos(d.plataSinDestino)}</p>
        <p className="mt-1 text-sm text-suave">
          {d.plataSinDestino > 0
            ? "Plata que ya está en la cuenta y todavía no tiene trabajo."
            : d.plataSinDestino === 0
              ? "Cada peso tiene un trabajo. 👌"
              : "Se asignó o gastó más de lo que hay."}
        </p>
        {d.plataSinDestino > 0 && (
          <Link href="/familia/sobres" className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-marca font-semibold text-white">
            Repartir en sobres
          </Link>
        )}
      </Tarjeta>

      {/* 2. Sobres que necesitan atención */}
      <Tarjeta titulo="Sobres que necesitan atención" accion={<Link href="/familia/sobres" className="text-sm font-semibold text-marca">Todos ›</Link>}>
        {d.sobresAtencion.length === 0 ? (
          <p className="text-sm text-suave">Todos los sobres vienen bien.</p>
        ) : (
          <ul className="space-y-3">
            {d.sobresAtencion.map((x) => (
              <li key={x.sobre.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{x.sobre.nombre}</span>
                  <span className={`cifra font-semibold ${x.disponible < 0 ? "text-rojo" : ""}`}>{pesos(x.disponible)}</span>
                </div>
                <BarraProgreso
                  valor={Math.max(x.disponible, 0)}
                  total={x.asignadoMes || 1}
                  etiqueta={`Queda en ${x.sobre.nombre}`}
                  tono={x.disponible < 0 ? "rojo" : "naranja"}
                />
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {/* 3. Fondo de emergencia */}
      {d.emergencia && (
        <Tarjeta titulo="Fondo de emergencia">
          <p className="cifra text-xl font-bold">
            {pesos(d.emergencia.disponible)} <span className="text-base font-normal text-suave">de {pesos(d.emergencia.meta)}</span>
          </p>
          <div className="mt-2">
            <BarraProgreso valor={d.emergencia.disponible} total={d.emergencia.meta} etiqueta="Fondo de emergencia" />
          </div>
        </Tarjeta>
      )}

      {/* 4. Próximo pago + sueldo recibido */}
      <Tarjeta titulo="Este mes">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Sueldo recibido del negocio</dt>
            <dd className="cifra font-semibold">{pesos(d.sueldoRecibidoMes)}</dd>
          </div>
          {d.proximoPago && (
            <div className="flex justify-between">
              <dt>
                Próximo pago: {d.proximoPago.nombre}
                <span className="block text-xs text-suave">vence {d.proximoPago.fecha.slice(8)}/{d.proximoPago.fecha.slice(5, 7)}</span>
              </dt>
              <dd className="cifra font-semibold">{pesos(d.proximoPago.monto)}</dd>
            </div>
          )}
        </dl>
      </Tarjeta>
    </>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl bg-borde/60" />
      ))}
    </div>
  );
}
