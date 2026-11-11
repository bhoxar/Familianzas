"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAmbito } from "@/lib/estado/ambito";
import { useEsDemo, useEstadoSync, useInstantanea } from "@/lib/estado/datos";
import { cerrarSesion, codigoInvitacion, salirDeDemo } from "@/lib/estado/sesion";
import { supabase } from "@/lib/offline/sync";
import { db } from "@/lib/offline/db";
import { eliminarEntidad, guardarEntidad } from "@/lib/offline/operaciones";
import type { UnidadNegocio } from "@/lib/dominio/tipos";
import { vivos } from "@/lib/dominio/utiles";
import { Boton, Tarjeta } from "@/components/ui";
import { Campo, Hoja, Mensaje } from "@/components/formulario";

function Enlace({ href, icono, texto, detalle }: { href: string; icono: string; texto: string; detalle?: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center gap-3 py-2">
        <span aria-hidden className="text-xl">{icono}</span>
        <span className="flex-1">
          <span className="block font-medium">{texto}</span>
          {detalle && <span className="text-xs text-suave">{detalle}</span>}
        </span>
        <span className="text-suave">›</span>
      </Link>
    </li>
  );
}

export default function Mas() {
  const { ambito } = useAmbito();
  const demo = useEsDemo();
  const sync = useEstadoSync();
  const s = useInstantanea();
  const router = useRouter();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [unidad, setUnidad] = useState<Partial<UnidadNegocio> | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const compartido = !!supabase();

  useEffect(() => { void codigoInvitacion().then(setCodigo); }, [s?.hogar.id]);
  if (!s) return null;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">{s.hogar.nombre}</h1>
      <Mensaje aviso={aviso} />
      <Tarjeta>
        <ul className="divide-y divide-borde">
          {ambito === "empresa" ? (
            <>
              <Enlace href="/negocio/sobres" icono="✉" texto="Sobres del negocio" detalle="Alimento, nafta, cuotas, impuestos" />
              <Enlace href="/negocio/deudas" icono="📉" texto="Deudas del negocio" detalle="Plan Hilux, proveedores" />
            </>
          ) : (
            <Enlace href="/familia/sobres" icono="🛟" texto="Metas" detalle="Fondo de emergencia y ahorro" />
          )}
          <Enlace href="/mas/cuentas" icono="🏦" texto="Cuentas y tarjetas" detalle="Saldos y pago del resumen por partes" />
          <Enlace href="/mas/dolar" icono="💵" texto="Dólar" detalle="Cotización del día y venta de dólares" />
          <Enlace href="/negocio/sueldo" icono="💰" texto="Reglas del sueldo" detalle="Orden de prioridades" />
          <Enlace href="/mas/sync" icono="⟳" texto="Sincronización"
            detalle={demo ? "Modo demostración" : sync.rechazados ? `⚠ ${sync.rechazados} para revisar` : sync.pendientes ? `${sync.pendientes} por subir` : "Todo al día"} />
        </ul>
      </Tarjeta>

      <Tarjeta titulo="Negocios" accion={<button className="text-sm font-semibold text-marca" onClick={() => setUnidad({ tipo: "otro", activa: true })}>+ Agregar</button>}>
        <ul className="divide-y divide-borde">
          {vivos(s.unidades).map((u) => (
            <li key={u.id}>
              <button className="flex min-h-12 w-full items-center justify-between text-left" onClick={() => setUnidad(u)}>
                <span>{u.nombre}{!u.activa && <span className="ml-2 text-xs text-suave">(pausado)</span>}</span>
                {u.fecha_inicio && u.fecha_inicio > new Date().toISOString().slice(0, 10) && (
                  <span className="text-xs text-suave">abre {u.fecha_inicio.split("-").reverse().join("/")}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Tarjeta>

      {compartido && !demo && (
        <Tarjeta titulo="Usuarios del hogar">
          <p className="text-sm">Para que tu pareja vea el mismo hogar, que entre con su email y ponga este código:</p>
          <p className="cifra mt-2 text-center text-3xl font-bold tracking-[0.3em]">{codigo ?? "······"}</p>
        </Tarjeta>
      )}

      {demo ? (
        <Tarjeta titulo="Modo demostración">
          <p className="text-sm text-suave">Estos datos son de ejemplo y quedan solo en este teléfono.</p>
          <Boton className="mt-3 w-full" onClick={async () => { await salirDeDemo(); router.replace("/"); }}>Empezar con mis datos</Boton>
        </Tarjeta>
      ) : compartido ? (
        <Boton variante="fantasma" className="w-full text-rojo" onClick={async () => {
          try { await cerrarSesion(); router.replace("/entrar"); } catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); }
        }}>Cerrar sesión</Boton>
      ) : (
        <p className="text-center text-xs text-suave">Los datos están guardados solo en este teléfono.</p>
      )}

      <Hoja abierta={!!unidad} onCerrar={() => setUnidad(null)} titulo={unidad?.id ? "Editar negocio" : "Nuevo negocio"}>
        {unidad && (
          <div className="space-y-3">
            <Campo etiqueta="Nombre"><input value={unidad.nombre ?? ""} onChange={(e) => setUnidad({ ...unidad, nombre: e.target.value })} className="campo" /></Campo>
            <Campo etiqueta="Fecha de inicio (opcional)"><input type="date" value={unidad.fecha_inicio ?? ""} onChange={(e) => setUnidad({ ...unidad, fecha_inicio: e.target.value || null })} className="campo" /></Campo>
            <label className="flex min-h-12 items-center gap-2"><input type="checkbox" checked={unidad.activa ?? true} onChange={(e) => setUnidad({ ...unidad, activa: e.target.checked })} className="size-5" /> Activo</label>
            <Boton className="w-full" disabled={!unidad.nombre?.trim()} onClick={async () => { await guardarEntidad(db(), s, "unidades_negocio", { ...unidad, nombre: unidad.nombre!.trim() }); setUnidad(null); }}>Guardar</Boton>
            {unidad.id && <Boton variante="fantasma" className="w-full text-rojo" onClick={async () => { if (confirm("¿Borrar este negocio?")) { await eliminarEntidad(db(), "unidades_negocio", unidad as UnidadNegocio); setUnidad(null); } }}>Borrar</Boton>}
          </div>
        )}
      </Hoja>
    </div>
  );
}
