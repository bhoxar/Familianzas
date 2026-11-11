/**
 * Repositorio: la ÚNICA puerta de escritura de la app.
 *
 * Toda operación:
 *  1. valida con las mismas reglas que la base de datos (para avisar al
 *     instante aunque no haya señal),
 *  2. escribe las filas en IndexedDB y en la cola `outbox` dentro de UNA
 *     transacción local, con un mismo `lote`,
 *  3. la UI se actualiza sola (useLiveQuery) y el motor de sync sube el lote
 *     cuando haya conexión.
 */
import {
  esquemaNuevaTransaccion,
  type Ambito,
  type Centavos,
  type NuevaTransaccion,
  type ReglaEmbudo,
  type Transaccion,
} from "../dominio/tipos";
import { resolverAmbito, saldoCuenta, saldosSobres, type Instantanea } from "../dominio/calculos";
import { crearTransferenciaSueldo, planificarIngreso, type PlanIngreso } from "../dominio/embudo";
import { ahoraISO, hoy, nuevoId } from "../dominio/utiles";
import type { Table } from "dexie";
import { idDispositivo, TABLAS_SYNC, type FamilianzasDB, type TablaSync } from "./db";

export interface Cambio {
  tabla: TablaSync;
  fila: { id?: string; hogar_id?: string } & Record<string, unknown>;
}

/** Guarda filas + cola de salida en una sola transacción local. */
export async function guardarLote(base: FamilianzasDB, cambios: Cambio[]): Promise<string> {
  const lote = nuevoId();
  const ordenados = [...cambios].sort(
    (a, b) => TABLAS_SYNC.indexOf(a.tabla) - TABLAS_SYNC.indexOf(b.tabla),
  );
  const tablas = [...new Set(ordenados.map((c) => c.tabla))].map((t) => base.table(t));
  await base.transaction("rw", [...tablas, base.outbox], async () => {
    for (const c of ordenados) {
      await base.table(c.tabla).put(c.fila);
      await base.outbox.add({
        lote,
        tabla: c.tabla,
        clave: String(c.fila.id ?? c.fila.hogar_id),
        fila: c.fila,
        creado_en: ahoraISO(),
        intentos: 0,
        error: null,
      });
    }
  });
  return lote;
}

/** Lee todo lo del hogar para calcular el Dashboard (offline). */
export async function leerInstantanea(base: FamilianzasDB, hogarId: string): Promise<Instantanea | null> {
  const hogar = await base.hogares.get(hogarId);
  if (!hogar) return null;
  const del = <T>(t: Table<T, string>): Promise<T[]> => t.where("hogar_id").equals(hogarId).toArray();
  const [unidades, cuentas, sobres, asignaciones, transacciones, deudores, cargos, cobros, deudas, reglas, distribuciones, config, cotizaciones] =
    await Promise.all([
      del(base.unidades_negocio),
      del(base.cuentas),
      del(base.sobres),
      del(base.asignaciones),
      del(base.transacciones),
      del(base.deudores),
      del(base.cargos),
      del(base.cobros_aplicados),
      del(base.deudas_propias),
      del(base.reglas_embudo),
      del(base.embudo_distribuciones),
      base.config_embudo.get(hogarId),
      base.cotizaciones.toArray(),
    ]);
  return {
    hogar, unidades, cuentas, sobres, asignaciones, transacciones, deudores, cargos, cobros,
    deudas, reglas, distribuciones, config: config ?? null,
    cotizaciones: cotizaciones.filter((c) => !c.hogar_id || c.hogar_id === hogarId),
  };
}

// ---------------------------------------------------------------------------
// Carga de movimientos (gasto / ingreso) con Embudo forzado
// ---------------------------------------------------------------------------
export interface ResultadoMovimiento {
  transaccion: Transaccion;
  /** Si fue un ingreso del negocio en modo forzado: cómo se repartió. */
  embudo: PlanIngreso | null;
}

export async function registrarMovimiento(
  base: FamilianzasDB,
  s: Instantanea,
  entrada: NuevaTransaccion,
  usuarioId?: string | null,
): Promise<ResultadoMovimiento> {
  const datos = esquemaNuevaTransaccion.parse(entrada);
  const cuenta = s.cuentas.find((c) => c.id === datos.cuenta_id);
  if (!cuenta) throw new Error("Cuenta inexistente");
  const sobre = datos.sobre_id ? s.sobres.find((x) => x.id === datos.sobre_id) : null;
  const ambito: Ambito = resolverAmbito(cuenta, sobre, datos.ambito);

  const signo = datos.tipo === "ingreso" ? 1 : datos.tipo === "ajuste" ? Math.sign(datos.monto) : -1;
  const marca = ahoraISO();
  const transaccion: Transaccion = {
    id: nuevoId(),
    hogar_id: s.hogar.id,
    cuenta_id: cuenta.id,
    ambito,
    unidad_negocio_id: datos.unidad_negocio_id ?? sobre?.unidad_negocio_id ?? cuenta.unidad_negocio_id ?? null,
    tipo: datos.tipo,
    fecha: datos.fecha,
    monto: signo * Math.abs(datos.monto),
    descripcion: datos.descripcion ?? null,
    sobre_id: sobre?.id ?? null,
    deuda_id: datos.deuda_id ?? null,
    creado_por: usuarioId ?? null,
    dispositivo_id: await idDispositivo(base),
    creado_en: marca,
    actualizado_en: marca,
  };

  const cambios: Cambio[] = [{ tabla: "transacciones", fila: { ...transaccion } }];

  // Embudo FORZADO: todo ingreso del negocio en pesos se reparte al instante.
  let embudo: PlanIngreso | null = null;
  const enPesos = cuenta.moneda === s.hogar.moneda_base;
  if (transaccion.tipo === "ingreso" && ambito === "empresa" && enPesos && s.config?.modo === "forzar") {
    embudo = planificarIngreso({
      ingreso: transaccion,
      reglas: s.reglas,
      distribuciones: s.distribuciones,
      config: s.config,
      usuarioId,
    });
    for (const a of embudo.asignaciones) cambios.push({ tabla: "asignaciones", fila: { ...a } });
    for (const d of embudo.distribuciones) cambios.push({ tabla: "embudo_distribuciones", fila: { ...d } });
  }

  await guardarLote(base, cambios);
  return { transaccion, embudo };
}

// ---------------------------------------------------------------------------
// Sueldo: confirmar que se pasó la plata a la familia
// ---------------------------------------------------------------------------
export async function confirmarSueldo(
  base: FamilianzasDB,
  s: Instantanea,
  params: { monto: Centavos; cuentaEmpresaId: string; cuentaFamiliaId?: string | null; usuarioId?: string | null },
): Promise<[Transaccion, Transaccion]> {
  const cfg = s.config;
  if (!cfg?.sobre_sueldo_id) throw new Error("Falta configurar el sobre 'Sueldo por transferir'");
  const cuentaEmpresa = s.cuentas.find((c) => c.id === params.cuentaEmpresaId);
  const cuentaFamilia = s.cuentas.find((c) => c.id === (params.cuentaFamiliaId ?? cfg.cuenta_familia_id));
  if (!cuentaEmpresa || !cuentaFamilia) throw new Error("Elegí las cuentas de origen y destino");

  const fecha = hoy();
  const disponible = saldosSobres(s, fecha).find((x) => x.sobre.id === cfg.sobre_sueldo_id)?.disponible ?? 0;
  const patas = crearTransferenciaSueldo({
    hogarId: s.hogar.id,
    monto: params.monto,
    fecha,
    cuentaEmpresa,
    cuentaFamilia,
    sobreSueldoId: cfg.sobre_sueldo_id,
    disponibleSobreSueldo: disponible,
    saldoCuentaEmpresa: saldoCuenta(cuentaEmpresa, s.transacciones),
    usuarioId: params.usuarioId,
    dispositivoId: await idDispositivo(base),
  });
  // Las dos patas viajan en el MISMO lote: el servidor valida que sumen cero.
  await guardarLote(base, patas.map((fila) => ({ tabla: "transacciones" as const, fila: { ...fila } })));
  return patas;
}

// ---------------------------------------------------------------------------
// Reglas del Embudo
// ---------------------------------------------------------------------------
/** Guarda el nuevo orden de la cascada (después de arrastrar en la pantalla). */
export async function reordenarReglas(base: FamilianzasDB, reglas: ReglaEmbudo[], idsEnOrden: string[]) {
  const marca = ahoraISO();
  const cambios: Cambio[] = idsEnOrden.flatMap((id, i) => {
    const r = reglas.find((x) => x.id === id);
    return r && r.orden !== i + 1
      ? [{ tabla: "reglas_embudo" as const, fila: { ...r, orden: i + 1, actualizado_en: marca } }]
      : [];
  });
  if (cambios.length) await guardarLote(base, cambios);
}

export async function guardarRegla(base: FamilianzasDB, regla: ReglaEmbudo) {
  await guardarLote(base, [{ tabla: "reglas_embudo", fila: { ...regla, actualizado_en: ahoraISO() } }]);
}
