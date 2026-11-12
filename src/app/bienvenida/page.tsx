"use client";
/**
 * Configuración inicial guiada (Fase 2, sección 13):
 *   0. Crear el hogar o sumarse con un código.
 *   1. Negocios.  2. Cuentas y saldos de hoy.  3. Sueldo y costos.  4. Listo.
 */
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, leerMeta } from "@/lib/offline/db";
import { supabase } from "@/lib/offline/sync";
import {
  aplicarConfiguracionInicial, crearHogarCompartido, crearHogarLocal, unirseAHogar,
} from "@/lib/estado/sesion";
import { CUENTAS_SUGERIDAS, type CuentaInicial, type RespuestasIniciales } from "@/lib/dominio/configuracion";
import type { Ambito, TipoCuenta } from "@/lib/dominio/tipos";
import { pesos } from "@/lib/dominio/utiles";
import { Boton, Tarjeta } from "@/components/ui";
import { Campo, EntradaMonto, Interruptor, leerMonto, Mensaje } from "@/components/formulario";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

export default function Bienvenida() {
  const hogarId = useLiveQuery(() => leerMeta(db(), "hogar_id"), []);
  if (hogarId === undefined) return null;
  return hogarId ? <Asistente /> : <CrearOUnirse />;
}

function CrearOUnirse() {
  const compartido = !!supabase();
  const [modo, setModo] = useState<"crear" | "unirse">("crear");
  const [hogar, setHogar] = useState("");
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, setOcupado] = useState(false);

  const ejecutar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      if (!compartido) await crearHogarLocal(hogar);
      else if (modo === "crear") await crearHogarCompartido(hogar, nombre);
      else await unirseAHogar(codigo, nombre);
    } catch (err) {
      setAviso({ tipo: "error", texto: (err as Error).message });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="pt-4 text-2xl font-bold">¡Bienvenidos!</h1>
      {compartido && (
        <div role="tablist" className="flex rounded-full bg-borde/70 p-1">
          {(["crear", "unirse"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={modo === m} onClick={() => setModo(m)}
              className={`min-h-10 flex-1 rounded-full text-sm font-semibold ${modo === m ? "bg-marca text-white" : "text-suave"}`}>
              {m === "crear" ? "Crear hogar" : "Tengo un código"}
            </button>
          ))}
        </div>
      )}
      <Tarjeta>
        <div className="space-y-3">
          {modo === "crear" || !compartido ? (
            <Campo etiqueta="Nombre del hogar" ayuda={compartido ? "Después vas a poder invitar a tu pareja con un código." : "Los datos quedan guardados solo en este teléfono."}>
              <input value={hogar} onChange={(e) => setHogar(e.target.value)} placeholder="Ej: Familia del campo" className="campo" />
            </Campo>
          ) : (
            <Campo etiqueta="Código de invitación" ayuda="Lo encontrás en Más → Usuarios del hogar, en el teléfono de tu pareja.">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} maxLength={6} className="campo cifra tracking-[0.3em]" />
            </Campo>
          )}
          {compartido && (
            <Campo etiqueta="Tu nombre">
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="campo" />
            </Campo>
          )}
          <Boton className="w-full" disabled={ocupado || (modo === "crear" ? !hogar.trim() : codigo.length !== 6)} onClick={ejecutar}>
            Continuar
          </Boton>
          <Mensaje aviso={aviso} />
        </div>
      </Tarjeta>
    </div>
  );
}

function Asistente() {
  const [paso, setPaso] = useState(1);
  const [negocios, setNegocios] = useState({ pensionado: true, alimento: true, cabanas: true, inauguracionCabanas: "" });
  const [cuentas, setCuentas] = useState<(CuentaInicial & { saldoTexto: string })[]>(
    CUENTAS_SUGERIDAS.map((c) => ({ ...c, saldoTexto: "" })),
  );
  const [montos, setMontos] = useState({ necesidad: "", minimo: "", alimento: "", cuotas: "", nafta: "", impuestos: "" });
  const [aviso, setAviso] = useState<Aviso>(null);
  const [guardando, setGuardando] = useState(false);

  const actualizarCuenta = (i: number, cambios: Partial<(typeof cuentas)[number]>) =>
    setCuentas((cs) => cs.map((c, j) => (j === i ? { ...c, ...cambios } : c)));

  const finalizar = async () => {
    setGuardando(true);
    try {
      const r: RespuestasIniciales = {
        negocios: { ...negocios, inauguracionCabanas: negocios.inauguracionCabanas || null },
        cuentas: cuentas.filter((c) => c.nombre.trim()).map((c) => ({ ...c, saldo: leerMonto(c.saldoTexto) })),
        necesidadFamiliar: leerMonto(montos.necesidad),
        sueldoMinimo: leerMonto(montos.minimo),
        reposicionAlimento: negocios.alimento ? leerMonto(montos.alimento) : 0,
        cuotasYSeguros: leerMonto(montos.cuotas),
        naftaYPeajes: leerMonto(montos.nafta),
        impuestos: leerMonto(montos.impuestos),
      };
      if (!r.cuentas.some((c) => c.ambito === "empresa") || !r.cuentas.some((c) => c.ambito === "familia")) {
        throw new Error("Necesitás al menos una cuenta del Negocio y una de la Familia: así se separa la plata.");
      }
      await aplicarConfiguracionInicial(r);
    } catch (err) {
      setAviso({ tipo: "error", texto: (err as Error).message });
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="pt-2 text-sm text-suave">Paso {paso} de 3</p>

      {paso === 1 && (
        <Tarjeta titulo="1 · Sus negocios">
          <Interruptor etiqueta="🐴 Pensionado equino" activo={negocios.pensionado} onChange={(v) => setNegocios({ ...negocios, pensionado: v })} />
          <Interruptor etiqueta="🌾 Venta de alimento" activo={negocios.alimento} onChange={(v) => setNegocios({ ...negocios, alimento: v })} />
          <Interruptor etiqueta="🏡 Cabañas" activo={negocios.cabanas} onChange={(v) => setNegocios({ ...negocios, cabanas: v })} />
          {negocios.cabanas && (
            <Campo etiqueta="Inauguración de las cabañas (opcional)">
              <input type="date" value={negocios.inauguracionCabanas} onChange={(e) => setNegocios({ ...negocios, inauguracionCabanas: e.target.value })} className="campo" />
            </Campo>
          )}
        </Tarjeta>
      )}

      {paso === 2 && (
        <Tarjeta titulo="2 · Cuentas y saldos de hoy">
          <p className="mb-3 text-sm text-suave">
            Cada cuenta es del <b>Negocio</b> o de la <b>Familia</b>. En las tarjetas poné lo que deben hoy (va a "Debemos").
          </p>
          <ul className="space-y-4">
            {cuentas.map((c, i) => (
              <li key={i} className="space-y-2 rounded-xl border border-borde p-3">
                <input aria-label="Nombre de la cuenta" value={c.nombre} onChange={(e) => actualizarCuenta(i, { nombre: e.target.value })} className="campo font-semibold" placeholder="Nombre (vacío = no usar)" />
                <div className="grid grid-cols-2 gap-2">
                  <select aria-label="Ámbito" value={c.ambito} onChange={(e) => actualizarCuenta(i, { ambito: e.target.value as Ambito })} className="campo">
                    <option value="empresa">🐴 Negocio</option>
                    <option value="familia">🏠 Familia</option>
                  </select>
                  <select aria-label="Tipo" value={c.tipo} onChange={(e) => actualizarCuenta(i, { tipo: e.target.value as TipoCuenta })} className="campo">
                    <option value="banco">Banco</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="billetera_virtual">Billetera virtual</option>
                    <option value="tarjeta_credito">Tarjeta de crédito</option>
                  </select>
                  <select aria-label="Moneda" value={c.moneda} onChange={(e) => actualizarCuenta(i, { moneda: e.target.value as "ARS" | "USD" })} className="campo">
                    <option value="ARS">Pesos</option>
                    <option value="USD">Dólares</option>
                  </select>
                  <EntradaMonto etiqueta={c.tipo === "tarjeta_credito" ? "Deuda hoy" : "Saldo hoy"} valor={c.saldoTexto}
                    placeholder={c.tipo === "tarjeta_credito" ? "Deuda hoy" : c.moneda === "USD" ? "US$ hoy" : "Saldo hoy"}
                    onChange={(v) => actualizarCuenta(i, { saldoTexto: v })} />
                </div>
                {c.tipo === "tarjeta_credito" && (
                  <Interruptor etiqueta="La usamos para Negocio y Familia" activo={!!c.compartida} onChange={(v) => actualizarCuenta(i, { compartida: v })} />
                )}
              </li>
            ))}
          </ul>
          <Boton variante="secundario" className="mt-3 w-full"
            onClick={() => setCuentas([...cuentas, { nombre: "", ambito: "familia", tipo: "efectivo", moneda: "ARS", saldo: 0, saldoTexto: "" }])}>
            + Otra cuenta
          </Boton>
        </Tarjeta>
      )}

      {paso === 3 && (
        <Tarjeta titulo="3 · El sueldo de la familia">
          <p className="mb-3 text-sm text-suave">
            Con esto armamos el orden en que cada cobro se reparte. Después lo pueden cambiar en Sueldo.
          </p>
          <div className="space-y-3">
            <Campo etiqueta="¿Cuánto necesita la familia por mes?"><EntradaMonto valor={montos.necesidad} onChange={(v) => setMontos({ ...montos, necesidad: v })} /></Campo>
            <Campo etiqueta="¿Cuál es el mínimo indispensable?" ayuda="Va arriba en la lista: se cubre antes que casi todo.">
              <EntradaMonto valor={montos.minimo} onChange={(v) => setMontos({ ...montos, minimo: v })} />
            </Campo>
            {negocios.alimento && (
              <Campo etiqueta="Reposición de alimento por mes"><EntradaMonto valor={montos.alimento} onChange={(v) => setMontos({ ...montos, alimento: v })} /></Campo>
            )}
            <Campo etiqueta="Cuotas (Hilux, materiales) y seguros por mes"><EntradaMonto valor={montos.cuotas} onChange={(v) => setMontos({ ...montos, cuotas: v })} /></Campo>
            <Campo etiqueta="Nafta y peajes por mes"><EntradaMonto valor={montos.nafta} onChange={(v) => setMontos({ ...montos, nafta: v })} /></Campo>
            <Campo etiqueta="Impuestos por mes"><EntradaMonto valor={montos.impuestos} onChange={(v) => setMontos({ ...montos, impuestos: v })} /></Campo>
            {leerMonto(montos.necesidad) > 0 && (
              <p className="rounded-xl bg-marca-suave p-3 text-sm text-marca">
                Fondo de emergencia sugerido (3 meses): <b>{pesos(leerMonto(montos.necesidad) * 3)}</b>
              </p>
            )}
          </div>
        </Tarjeta>
      )}

      <Mensaje aviso={aviso} />
      <div className="flex gap-2">
        {paso > 1 && <Boton variante="secundario" className="flex-1" onClick={() => setPaso(paso - 1)}>Atrás</Boton>}
        {paso < 3 ? (
          <Boton className="flex-1" onClick={() => setPaso(paso + 1)}>Siguiente</Boton>
        ) : (
          <Boton className="flex-1" disabled={guardando} onClick={finalizar}>Empezar</Boton>
        )}
      </div>
    </div>
  );
}
