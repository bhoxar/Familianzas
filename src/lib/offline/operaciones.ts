/**
 * Operaciones de escritura de las pantallas (Me deben, Sobres, Debemos,
 * Tarjetas, Dólar, Administración). Todas validan como la base de datos y
 * guardan en un lote local que se sincroniza después.
 */
import type {
  Ambito, Asignacion, Cargo, Centavos, CobroAplicado, Cotizacion, Cuenta, EstrategiaDeuda, Fecha, Transaccion,
} from "../dominio/tipos";
import {
  cuentasPorCobrar, cotizacionVigente, plataSinDestino, saldoCuenta, saldosSobres, tarjetasPorAmbito, type Instantanea,
} from "../dominio/calculos";
import { planificarIngreso } from "../dominio/embudo";
import { estadoDeudas } from "../dominio/deudas";
import { proponerReparto, type PropuestaReparto } from "../dominio/presupuesto";
import { ahoraISO, hoy, idDeterminista, inicioDeMes, nuevoId, pesos, sumarDias, usdAPesos, vivos } from "../dominio/utiles";
import { idDispositivo, type FamilianzasDB, type TablaSync } from "./db";
import { guardarLote, type Cambio } from "./repositorio";

export class ErrorOperacion extends Error {}

const marca = () => ahoraISO();
const fila = <T extends object>(tabla: TablaSync, f: T): Cambio => ({ tabla, fila: { ...f } as Cambio["fila"] });

function cuentaDe(s: Instantanea, id: string): Cuenta {
  const c = s.cuentas.find((x) => x.id === id && !x.eliminado_en);
  if (!c) throw new ErrorOperacion("Cuenta inexistente");
  return c;
}

function nuevaTrx(s: Instantanea, t: Omit<Transaccion, "id" | "hogar_id" | "creado_en" | "actualizado_en">, dispositivo: string): Transaccion {
  const m = marca();
  return { id: nuevoId(), hogar_id: s.hogar.id, creado_en: m, actualizado_en: m, dispositivo_id: dispositivo, ...t };
}

/** Si corresponde, agrega al lote el reparto del Embudo para un ingreso en pesos del negocio. */
function conEmbudo(s: Instantanea, ingreso: Transaccion, cambios: Cambio[]) {
  const cuenta = cuentaDe(s, ingreso.cuenta_id);
  if (ingreso.ambito !== "empresa" || cuenta.moneda !== s.hogar.moneda_base || s.config?.modo !== "forzar") return null;
  const plan = planificarIngreso({ ingreso, reglas: s.reglas, distribuciones: s.distribuciones, config: s.config });
  plan.asignaciones.forEach((a) => cambios.push(fila("asignaciones", a)));
  plan.distribuciones.forEach((d) => cambios.push(fila("embudo_distribuciones", d)));
  return plan;
}

// ===========================================================================
// ME DEBEN
// ===========================================================================

/**
 * Cobro a un cliente: registra el ingreso, lo aplica a sus deudas más viejas
 * primero y lo reparte con el Embudo. Lo que sobre queda a favor del cliente.
 */
export async function registrarCobroCliente(
  base: FamilianzasDB, s: Instantanea,
  p: { deudorId: string; monto: Centavos; cuentaId: string; fecha?: Fecha; cargoIds?: string[] },
) {
  if (!Number.isInteger(p.monto) || p.monto <= 0) throw new ErrorOperacion("Monto inválido");
  const deudor = s.deudores.find((d) => d.id === p.deudorId);
  if (!deudor) throw new ErrorOperacion("Cliente inexistente");
  const cuenta = cuentaDe(s, p.cuentaId);
  if (cuenta.ambito !== "empresa" || cuenta.tipo === "tarjeta_credito") throw new ErrorOperacion("Los cobros entran a una cuenta del negocio");
  const fecha = p.fecha ?? hoy();

  const ingreso = nuevaTrx(s, {
    cuenta_id: cuenta.id, ambito: "empresa", unidad_negocio_id: deudor.unidad_negocio_id, tipo: "ingreso",
    fecha, monto: p.monto, descripcion: `Cobro ${deudor.nombre}`,
  }, await idDispositivo(base));
  const cambios: Cambio[] = [fila("transacciones", ingreso)];

  // Valor del cobro en la moneda de los cargos (pesos)
  const cot = cotizacionVigente(s, fecha)?.promedio;
  if (cuenta.moneda === "USD" && !cot) throw new ErrorOperacion("Cargá la cotización del dólar antes de cobrar en dólares");
  let porAplicar = cuenta.moneda === "USD" ? usdAPesos(p.monto, cot!) : p.monto;
  if (cuenta.moneda === "USD") Object.assign(ingreso, { tipo_cambio: cot });

  const pendientes = cuentasPorCobrar(s, fecha)
    .filter((x) => x.deudor.id === deudor.id && (!p.cargoIds || p.cargoIds.includes(x.cargo.id)))
    .sort((a, b) => (a.cargo.fecha_vencimiento < b.cargo.fecha_vencimiento ? -1 : 1));
  const aplicados: CobroAplicado[] = [];
  for (const x of pendientes) {
    if (porAplicar <= 0) break;
    const monto = Math.min(porAplicar, x.saldo);
    const m = marca();
    aplicados.push({ id: nuevoId(), hogar_id: s.hogar.id, transaccion_id: ingreso.id, cargo_id: x.cargo.id, monto, creado_en: m, actualizado_en: m });
    porAplicar -= monto;
  }
  aplicados.forEach((a) => cambios.push(fila("cobros_aplicados", a)));
  const embudo = conEmbudo(s, ingreso, cambios);
  await guardarLote(base, cambios);
  return { ingreso, aplicados, aFavor: Math.max(porAplicar, 0), embudo };
}

/** Crea las cuotas del mes de cada cliente con tarifa. Id determinista: no se duplica entre teléfonos. */
export async function generarCuotasMes(base: FamilianzasDB, s: Instantanea, fecha: Fecha = hoy()) {
  const mes = inicioDeMes(fecha);
  const existentes = new Set(s.cargos.map((c) => c.id));
  const nuevos: Cargo[] = [];
  for (const d of vivos(s.deudores).filter((d) => d.activo && d.tarifa_mensual)) {
    const id = idDeterminista("cuota", d.id, mes);
    if (existentes.has(id)) continue;
    const cant = d.cantidad_unidades ?? 1;
    const m = marca();
    nuevos.push({
      id, hogar_id: s.hogar.id, unidad_negocio_id: d.unidad_negocio_id, deudor_id: d.id,
      concepto: `Cuota ${mes.slice(0, 7)}${cant > 1 ? ` · ${cant} unidades` : ""}`, periodo: mes, moneda: "ARS",
      monto: d.tarifa_mensual! * cant, fecha_emision: mes, fecha_vencimiento: sumarDias(mes, (d.dia_vencimiento ?? 10) - 1),
      probabilidad_cobro: 100, estado: "pendiente", creado_en: m, actualizado_en: m,
    });
  }
  if (nuevos.length) await guardarLote(base, nuevos.map((c) => fila("cargos", c)));
  return nuevos;
}

export async function crearCargo(base: FamilianzasDB, s: Instantanea, p: {
  deudorId: string; concepto: string; monto: Centavos; vencimiento: Fecha; moneda?: "ARS" | "USD";
}) {
  const d = s.deudores.find((x) => x.id === p.deudorId);
  if (!d) throw new ErrorOperacion("Cliente inexistente");
  if (!p.concepto.trim() || p.monto <= 0) throw new ErrorOperacion("Completá concepto y monto");
  const m = marca();
  const cargo: Cargo = {
    id: nuevoId(), hogar_id: s.hogar.id, unidad_negocio_id: d.unidad_negocio_id, deudor_id: d.id, concepto: p.concepto.trim(),
    periodo: null, moneda: p.moneda ?? "ARS", monto: p.monto, fecha_emision: hoy(), fecha_vencimiento: p.vencimiento,
    probabilidad_cobro: 100, estado: "pendiente", creado_en: m, actualizado_en: m,
  };
  await guardarLote(base, [fila("cargos", cargo)]);
  return cargo;
}

/** Marca una deuda de cliente como incobrable o ajusta la probabilidad de cobro. */
export async function actualizarCargo(base: FamilianzasDB, cargo: Cargo, cambios: Partial<Pick<Cargo, "estado" | "probabilidad_cobro">>) {
  await guardarLote(base, [fila("cargos", { ...cargo, ...cambios, actualizado_en: marca() })]);
}

// ===========================================================================
// SOBRES
// ===========================================================================

/** Dar plata a un sobre desde la plata sin destino. No permite asignar plata que no existe. */
export async function asignarASobre(base: FamilianzasDB, s: Instantanea, sobreId: string, monto: Centavos, fecha: Fecha = hoy()) {
  const sobre = s.sobres.find((x) => x.id === sobreId);
  if (!sobre) throw new ErrorOperacion("Sobre inexistente");
  if (!Number.isInteger(monto) || monto === 0) throw new ErrorOperacion("Monto inválido");
  if (monto > 0) {
    const libre = plataSinDestino(s, sobre.ambito, fecha).monto;
    if (monto > libre) throw new ErrorOperacion(`Solo hay ${pesos(Math.max(libre, 0))} sin destino`);
  } else {
    const disp = saldosSobres(s, fecha).find((x) => x.sobre.id === sobreId)?.disponible ?? 0;
    if (-monto > disp) throw new ErrorOperacion(`El sobre solo tiene ${pesos(Math.max(disp, 0))}`);
  }
  const m = marca();
  const a: Asignacion = { id: nuevoId(), hogar_id: s.hogar.id, sobre_id: sobreId, mes: inicioDeMes(fecha), monto, creado_en: m, actualizado_en: m };
  await guardarLote(base, [fila("asignaciones", a)]);
  return a;
}

/** Mover plata entre dos sobres del MISMO ámbito. */
export async function moverEntreSobres(base: FamilianzasDB, s: Instantanea, origenId: string, destinoId: string, monto: Centavos, fecha: Fecha = hoy()) {
  const o = s.sobres.find((x) => x.id === origenId);
  const d = s.sobres.find((x) => x.id === destinoId);
  if (!o || !d || o.id === d.id) throw new ErrorOperacion("Elegí dos sobres distintos");
  if (o.ambito !== d.ambito) throw new ErrorOperacion("No se mezclan fondos: los sobres son de ámbitos distintos");
  if (!Number.isInteger(monto) || monto <= 0) throw new ErrorOperacion("Monto inválido");
  const disp = saldosSobres(s, fecha).find((x) => x.sobre.id === origenId)?.disponible ?? 0;
  if (monto > disp) throw new ErrorOperacion(`"${o.nombre}" solo tiene ${pesos(Math.max(disp, 0))}`);
  const m = marca();
  const mes = inicioDeMes(fecha);
  await guardarLote(base, [
    fila("asignaciones", { id: nuevoId(), hogar_id: s.hogar.id, sobre_id: o.id, mes, monto: -monto, nota: `A ${d.nombre}`, creado_en: m, actualizado_en: m }),
    fila("asignaciones", { id: nuevoId(), hogar_id: s.hogar.id, sobre_id: d.id, mes, monto, nota: `De ${o.nombre}`, creado_en: m, actualizado_en: m }),
  ]);
}

export function propuestaRepartoAuto(s: Instantanea, ambito: Ambito, fecha: Fecha = hoy()): PropuestaReparto[] {
  return proponerReparto(saldosSobres(s, fecha), ambito, plataSinDestino(s, ambito, fecha).monto);
}

export async function aplicarReparto(base: FamilianzasDB, s: Instantanea, propuesta: PropuestaReparto[], fecha: Fecha = hoy()) {
  if (!propuesta.length) return;
  const total = propuesta.reduce((a, p) => a + p.monto, 0);
  const ambito = propuesta[0].sobre.ambito;
  if (total > plataSinDestino(s, ambito, fecha).monto) throw new ErrorOperacion("La plata sin destino cambió; volvé a calcular");
  const m = marca();
  await guardarLote(base, propuesta.map((p) => fila("asignaciones", {
    id: nuevoId(), hogar_id: s.hogar.id, sobre_id: p.sobre.id, mes: inicioDeMes(fecha), monto: p.monto, nota: "Reparto automático", creado_en: m, actualizado_en: m,
  })));
}

// ===========================================================================
// DEUDAS Y TARJETAS
// ===========================================================================

/** Pago de una deuda (o la cuota del mes, que puede debitarse de una tarjeta). */
export async function pagarDeuda(base: FamilianzasDB, s: Instantanea, p: { deudaId: string; cuentaId: string; monto: Centavos; fecha?: Fecha }) {
  const estado = estadoDeudas(s.deudas, s.transacciones).find((e) => e.deuda.id === p.deudaId);
  if (!estado) throw new ErrorOperacion("Deuda inexistente o cancelada");
  const d = estado.deuda;
  const cuenta = cuentaDe(s, p.cuentaId);
  if (!cuenta.compartida && cuenta.ambito !== d.ambito) {
    throw new ErrorOperacion(`No se mezclan fondos: esta deuda es de ${d.ambito === "empresa" ? "Negocio" : "Familia"}`);
  }
  if (!Number.isInteger(p.monto) || p.monto <= 0) throw new ErrorOperacion("Monto inválido");
  const t = nuevaTrx(s, {
    cuenta_id: cuenta.id, ambito: d.ambito, unidad_negocio_id: d.unidad_negocio_id ?? null, tipo: "pago_deuda",
    fecha: p.fecha ?? hoy(), monto: -p.monto, descripcion: `Pago ${d.acreedor}`, sobre_id: d.sobre_id ?? null, deuda_id: d.id,
  }, await idDispositivo(base));
  const cambios: Cambio[] = [fila("transacciones", t)];
  if (p.monto >= estado.saldo) cambios.push(fila("deudas_propias", { ...d, cancelada: true, actualizado_en: marca() }));
  await guardarLote(base, cambios);
  return t;
}

/** Pagar la parte de un ámbito del resumen de una tarjeta. */
export async function pagarTarjeta(base: FamilianzasDB, s: Instantanea, p: { tarjetaId: string; ambito: Ambito; cuentaId: string; monto: Centavos; fecha?: Fecha }) {
  const tarjeta = cuentaDe(s, p.tarjetaId);
  const origen = cuentaDe(s, p.cuentaId);
  if (tarjeta.tipo !== "tarjeta_credito") throw new ErrorOperacion("No es una tarjeta");
  if (origen.ambito !== p.ambito) throw new ErrorOperacion("Cada parte paga la suya: el Negocio no paga lo de la Familia ni al revés");
  if (!tarjeta.compartida && tarjeta.ambito !== p.ambito) throw new ErrorOperacion("La tarjeta no es de ese ámbito");
  if (!Number.isInteger(p.monto) || p.monto <= 0) throw new ErrorOperacion("Monto inválido");
  const deuda = tarjetasPorAmbito(s).find((t) => t.cuenta.id === tarjeta.id && t.ambito === p.ambito)?.deuda ?? 0;
  if (p.monto > deuda) throw new ErrorOperacion(`La parte a pagar es ${pesos(Math.max(deuda, 0))}`);
  if (p.monto > saldoCuenta(origen, s.transacciones)) throw new ErrorOperacion("La cuenta no tiene ese saldo");
  const disp = await idDispositivo(base);
  const grupo = nuevoId();
  const fecha = p.fecha ?? hoy();
  const sale = nuevaTrx(s, { cuenta_id: origen.id, ambito: p.ambito, tipo: "transferencia", fecha, monto: -p.monto, grupo_id: grupo, descripcion: `Pago ${tarjeta.nombre}` }, disp);
  const entra = nuevaTrx(s, { cuenta_id: tarjeta.id, ambito: p.ambito, tipo: "transferencia", fecha, monto: p.monto, grupo_id: grupo, descripcion: `Pago ${tarjeta.nombre}` }, disp);
  await guardarLote(base, [fila("transacciones", sale), fila("transacciones", entra)]);
}

export async function cambiarEstrategia(base: FamilianzasDB, s: Instantanea, estrategia: EstrategiaDeuda) {
  await guardarLote(base, [{ tabla: "hogares", fila: { ...s.hogar, estrategia_deuda: estrategia, actualizado_en: marca() } }]);
}

// ===========================================================================
// DÓLARES
// ===========================================================================

/** Guarda la cotización del día del hogar (una por día: id determinista). */
export async function guardarCotizacion(base: FamilianzasDB, s: Instantanea, p: { compra: number; venta: number; fecha?: Fecha; fuente: "automatica" | "manual" }) {
  if (!(p.compra > 0 && p.venta > 0)) throw new ErrorOperacion("Cotización inválida");
  const fecha = p.fecha ?? hoy();
  const c: Cotizacion = {
    id: idDeterminista("cotizacion", s.hogar.id, fecha, "blue"), hogar_id: s.hogar.id, fecha, tipo: "blue",
    compra: p.compra, venta: p.venta, promedio: Math.round(((p.compra + p.venta) / 2) * 10_000) / 10_000, fuente: p.fuente,
  };
  await guardarLote(base, [{ tabla: "cotizaciones", fila: { ...c, hogar_id: s.hogar.id } }]);
  return c;
}

/**
 * Dólar blue de una API pública con los mismos valores que dolarhoy.com.
 * Si falla (sin señal, API caída), la app usa la última guardada y se puede cargar a mano.
 */
export async function obtenerDolarBlue(fetcher: typeof fetch = fetch): Promise<{ compra: number; venta: number } | null> {
  try {
    const r = await fetcher("https://dolarapi.com/v1/dolares/blue", { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { compra?: number; venta?: number };
    return j.compra && j.venta ? { compra: j.compra, venta: j.venta } : null;
  } catch {
    return null;
  }
}

/** Vender dólares: US$ salen de la cuenta en dólares, entran pesos al promedio. Los pesos del negocio pasan por el Embudo. */
export async function convertirDolares(base: FamilianzasDB, s: Instantanea, p: { cuentaUsdId: string; cuentaPesosId: string; usd: Centavos; cotizacion: number; fecha?: Fecha }) {
  const usd = cuentaDe(s, p.cuentaUsdId);
  const ars = cuentaDe(s, p.cuentaPesosId);
  if (usd.moneda !== "USD" || ars.moneda !== s.hogar.moneda_base) throw new ErrorOperacion("Elegí una cuenta en dólares y una en pesos");
  if (usd.ambito !== ars.ambito) throw new ErrorOperacion("Las dos cuentas deben ser del mismo ámbito");
  if (!Number.isInteger(p.usd) || p.usd <= 0) throw new ErrorOperacion("Monto inválido");
  if (p.usd > saldoCuenta(usd, s.transacciones)) throw new ErrorOperacion("No hay tantos dólares en esa cuenta");
  if (!(p.cotizacion > 0)) throw new ErrorOperacion("Cotización inválida");
  const disp = await idDispositivo(base);
  const grupo = nuevoId();
  const fecha = p.fecha ?? hoy();
  const pesosRecibidos = usdAPesos(p.usd, p.cotizacion);
  const sale = nuevaTrx(s, { cuenta_id: usd.id, ambito: usd.ambito, unidad_negocio_id: usd.unidad_negocio_id ?? null, tipo: "transferencia", fecha, monto: -p.usd, grupo_id: grupo, tipo_cambio: p.cotizacion, descripcion: "Venta de dólares" }, disp);
  const entra = nuevaTrx(s, { cuenta_id: ars.id, ambito: ars.ambito, unidad_negocio_id: usd.unidad_negocio_id ?? null, tipo: "transferencia", fecha, monto: pesosRecibidos, grupo_id: grupo, tipo_cambio: p.cotizacion, descripcion: "Venta de dólares" }, disp);
  const cambios: Cambio[] = [fila("transacciones", sale), fila("transacciones", entra)];
  const embudo = conEmbudo(s, entra, cambios);
  await guardarLote(base, cambios);
  return { pesosRecibidos, embudo };
}

// ===========================================================================
// ADMINISTRACIÓN (altas, ediciones y bajas lógicas)
// ===========================================================================
export type TablaEditable = "unidades_negocio" | "cuentas" | "sobres" | "deudores" | "deudas_propias" | "reglas_embudo";

export async function guardarEntidad<T extends { id?: string }>(base: FamilianzasDB, s: Instantanea, tabla: TablaEditable, datos: T) {
  const m = marca();
  const filaFinal = { creado_en: m, ...datos, id: datos.id ?? nuevoId(), hogar_id: s.hogar.id, actualizado_en: m };
  await guardarLote(base, [{ tabla, fila: filaFinal }]);
  return filaFinal;
}

export async function eliminarEntidad(base: FamilianzasDB, tabla: TablaEditable, filaActual: { id: string; hogar_id: string }) {
  const m = marca();
  await guardarLote(base, [{ tabla, fila: { ...filaActual, eliminado_en: m, actualizado_en: m } }]);
}

export async function guardarConfigEmbudo(base: FamilianzasDB, s: Instantanea, cambios: Partial<NonNullable<Instantanea["config"]>>) {
  const actual = s.config ?? { hogar_id: s.hogar.id, modo: "forzar" as const, sobre_sueldo_id: null, cuenta_familia_id: null, actualizado_en: marca() };
  await guardarLote(base, [{ tabla: "config_embudo", fila: { ...actual, ...cambios, hogar_id: s.hogar.id, actualizado_en: marca() } }]);
}
