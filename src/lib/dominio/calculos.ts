/**
 * Cálculos de lectura: espejo en TypeScript de las vistas SQL
 * (v_saldo_cuentas, v_sobres_disponible, v_tarjetas_por_ambito,
 *  v_listo_para_asignar, v_cuentas_por_cobrar, v_flujo_mes).
 *
 * Existen porque la app debe mostrar el Dashboard SIN señal, a partir de los
 * datos guardados en el teléfono. Los tests verifican que dan lo mismo que
 * el SQL (supabase/tests/reglas_negocio.sql).
 */
import type {
  Ambito,
  Asignacion,
  Cargo,
  Centavos,
  CobroAplicado,
  Cotizacion,
  Cuenta,
  Deudor,
  EmbudoDistribucion,
  Fecha,
  Hogar,
  ReglaEmbudo,
  ConfigEmbudo,
  Semaforo,
  Sobre,
  Transaccion,
  UnidadNegocio,
  DeudaPropia,
} from "./tipos";
import { diasEntre, finDeMes, inicioDeMes, sumar, vivos } from "./utiles";

/** Todo lo que el Dashboard necesita, tal como está en la base local. */
export interface Instantanea {
  hogar: Hogar;
  unidades: UnidadNegocio[];
  cuentas: Cuenta[];
  sobres: Sobre[];
  asignaciones: Asignacion[];
  transacciones: Transaccion[];
  deudores: Deudor[];
  cargos: Cargo[];
  cobros: CobroAplicado[];
  cotizaciones: Cotizacion[];
  deudas: DeudaPropia[];
  reglas: ReglaEmbudo[];
  distribuciones: EmbudoDistribucion[];
  config: ConfigEmbudo | null;
}

// ---------------------------------------------------------------------------
// Reglas de separación (espejo del trigger trx_validar_ambito)
// ---------------------------------------------------------------------------
export class ErrorSeparacion extends Error {}

/**
 * Devuelve el ámbito que tendrá la transacción. Lanza si mezcla fondos.
 * Se usa al guardar offline para avisar al instante, sin esperar al servidor.
 */
export function resolverAmbito(
  cuenta: Cuenta,
  sobre: Sobre | null | undefined,
  ambitoPedido?: Ambito | null,
): Ambito {
  let ambito: Ambito;
  if (cuenta.compartida) {
    const elegido = sobre?.ambito ?? ambitoPedido;
    if (!elegido) {
      throw new ErrorSeparacion("Tarjeta compartida: indicá si el movimiento es del Negocio o de la Familia");
    }
    ambito = elegido;
  } else {
    ambito = cuenta.ambito;
  }
  if (sobre && sobre.ambito !== ambito) {
    throw new ErrorSeparacion(
      `No se mezclan fondos: el sobre "${sobre.nombre}" es de ${sobre.ambito === "empresa" ? "Negocio" : "Familia"}`,
    );
  }
  return ambito;
}

// ---------------------------------------------------------------------------
// Cotización
// ---------------------------------------------------------------------------
/** Manual del hogar si la hay en la fecha más reciente; si no, la automática. */
export function cotizacionVigente(s: Instantanea, fecha: Fecha): Cotizacion | null {
  const candidatas = s.cotizaciones
    .filter((c) => c.tipo === "blue" && c.fecha <= fecha && (!c.hogar_id || c.hogar_id === s.hogar.id))
    .sort((a, b) =>
      a.fecha === b.fecha ? (a.hogar_id ? -1 : 1) : a.fecha < b.fecha ? 1 : -1,
    );
  return candidatas[0] ?? null;
}

// ---------------------------------------------------------------------------
// Saldos
// ---------------------------------------------------------------------------
export function saldoCuenta(cuenta: Cuenta, transacciones: Transaccion[]): Centavos {
  return (
    cuenta.saldo_inicial +
    sumar(vivos(transacciones).filter((t) => t.cuenta_id === cuenta.id).map((t) => t.monto))
  );
}

export interface SaldoSobre {
  sobre: Sobre;
  asignadoMes: Centavos;
  actividadMes: Centavos;
  disponible: Centavos;
}

export function saldosSobres(s: Instantanea, hoy: Fecha): SaldoSobre[] {
  const mes = inicioDeMes(hoy);
  const asign = vivos(s.asignaciones);
  const trx = vivos(s.transacciones);
  return vivos(s.sobres).map((sobre) => {
    const a = asign.filter((x) => x.sobre_id === sobre.id && x.mes <= hoy);
    const t = trx.filter((x) => x.sobre_id === sobre.id);
    return {
      sobre,
      asignadoMes: sumar(a.filter((x) => x.mes === mes).map((x) => x.monto)),
      actividadMes: sumar(t.filter((x) => x.fecha >= mes).map((x) => x.monto)),
      disponible: sumar(a.map((x) => x.monto)) + sumar(t.map((x) => x.monto)),
    };
  });
}

export interface TarjetaAmbito {
  cuenta: Cuenta;
  ambito: Ambito;
  deuda: Centavos;
  comprasAPagar: Centavos;
}

export function tarjetasPorAmbito(s: Instantanea): TarjetaAmbito[] {
  const trx = vivos(s.transacciones);
  const out: TarjetaAmbito[] = [];
  for (const c of vivos(s.cuentas).filter((c) => c.tipo === "tarjeta_credito")) {
    const ambitos: Ambito[] = c.compartida ? ["empresa", "familia"] : [c.ambito];
    for (const ambito of ambitos) {
      const mov = sumar(trx.filter((t) => t.cuenta_id === c.id && t.ambito === ambito).map((t) => t.monto));
      const inicial = ambito === c.ambito ? c.saldo_inicial : 0;
      out.push({ cuenta: c, ambito, deuda: 0 - (inicial + mov), comprasAPagar: Math.max(0 - mov, 0) });
    }
  }
  return out;
}

/**
 * "Plata sin destino" (Listo para asignar):
 *   pesos reales − asignado a sobres (solo positivos) − compras con tarjeta aún no pagadas.
 * Nunca cuenta lo que nos deben. Los dólares se informan aparte.
 */
export function plataSinDestino(s: Instantanea, ambito: Ambito, hoy: Fecha) {
  const cuentas = vivos(s.cuentas).filter((c) => c.ambito === ambito && c.tipo !== "tarjeta_credito");
  const pesos = sumar(
    cuentas.filter((c) => c.moneda === s.hogar.moneda_base).map((c) => saldoCuenta(c, s.transacciones)),
  );
  const dolares = sumar(
    cuentas.filter((c) => c.moneda === "USD").map((c) => saldoCuenta(c, s.transacciones)),
  );
  const enSobres = sumar(
    saldosSobres(s, hoy)
      .filter((x) => x.sobre.ambito === ambito)
      .map((x) => Math.max(x.disponible, 0)),
  );
  const tarjetas = sumar(
    tarjetasPorAmbito(s).filter((t) => t.ambito === ambito).map((t) => t.comprasAPagar),
  );
  return { monto: pesos - enSobres - tarjetas, pesosEnCuentas: pesos, dolares };
}

// ---------------------------------------------------------------------------
// Cuentas por cobrar ("Me deben")
// ---------------------------------------------------------------------------
export interface Pendiente {
  cargo: Cargo;
  deudor: Deudor;
  pagado: Centavos;
  saldo: Centavos;
  diasAtraso: number;
  semaforo: Semaforo;
}

export function semaforo(hoy: Fecha, vencimiento: Fecha, diasGracia: number): Semaforo {
  const atraso = diasEntre(vencimiento, hoy);
  if (atraso <= 0) return "al_dia";
  if (atraso <= diasGracia) return "gracia";
  if (atraso <= 30) return "atrasado";
  if (atraso <= 60) return "moroso";
  return "critico";
}

export function cuentasPorCobrar(s: Instantanea, hoy: Fecha): Pendiente[] {
  const trxVivas = new Set(vivos(s.transacciones).map((t) => t.id));
  const cobros = vivos(s.cobros).filter((c) => trxVivas.has(c.transaccion_id));
  const deudores = new Map(s.deudores.map((d) => [d.id, d]));
  return vivos(s.cargos)
    .filter((c) => c.estado === "pendiente" || c.estado === "parcial")
    .map((cargo) => {
      const deudor = deudores.get(cargo.deudor_id)!;
      const pagado = sumar(cobros.filter((c) => c.cargo_id === cargo.id).map((c) => c.monto));
      return {
        cargo,
        deudor,
        pagado,
        saldo: cargo.monto - pagado,
        diasAtraso: Math.max(diasEntre(cargo.fecha_vencimiento, hoy), 0),
        semaforo: semaforo(hoy, cargo.fecha_vencimiento, deudor.dias_gracia),
      };
    })
    .filter((p) => p.saldo > 0)
    .sort((a, b) => b.diasAtraso - a.diasAtraso);
}

/** Agrupa lo pendiente por cliente: lo que muestra "Me deben". */
export function deudoresMorosos(pendientes: Pendiente[]) {
  const porDeudor = new Map<string, { deudor: Deudor; saldo: Centavos; diasAtraso: number; semaforo: Semaforo }>();
  const peso: Record<Semaforo, number> = { al_dia: 0, gracia: 1, atrasado: 2, moroso: 3, critico: 4 };
  for (const p of pendientes) {
    const prev = porDeudor.get(p.deudor.id);
    if (!prev) {
      porDeudor.set(p.deudor.id, { deudor: p.deudor, saldo: p.saldo, diasAtraso: p.diasAtraso, semaforo: p.semaforo });
    } else {
      prev.saldo += p.saldo;
      if (p.diasAtraso > prev.diasAtraso) prev.diasAtraso = p.diasAtraso;
      if (peso[p.semaforo] > peso[prev.semaforo]) prev.semaforo = p.semaforo;
    }
  }
  return [...porDeudor.values()].sort((a, b) => b.diasAtraso - a.diasAtraso || b.saldo - a.saldo);
}

// ---------------------------------------------------------------------------
// Flujo del mes: esperado vs real (en pesos)
// ---------------------------------------------------------------------------
export interface FlujoMes {
  /** Lo que nos deben y vence hasta fin de mes, ponderado por probabilidad de cobro. */
  esperado: Centavos;
  cobrado: Centavos;
  gastado: Centavos;
}

export function flujoMes(s: Instantanea, hoy: Fecha, unidadId?: string | null): FlujoMes {
  const ini = inicioDeMes(hoy);
  const fin = finDeMes(hoy);
  const cot = cotizacionVigente(s, hoy)?.promedio ?? 0;
  const monedaCuenta = new Map(s.cuentas.map((c) => [c.id, c.moneda]));
  const enPesos = (t: Transaccion) =>
    monedaCuenta.get(t.cuenta_id) === "USD" ? Math.round(t.monto * (t.tipo_cambio ?? cot)) : t.monto;

  const empresa = vivos(s.transacciones).filter(
    (t) =>
      t.ambito === "empresa" &&
      t.fecha >= ini &&
      t.fecha <= fin &&
      (!unidadId || t.unidad_negocio_id === unidadId),
  );

  const esperado = sumar(
    cuentasPorCobrar(s, hoy)
      .filter((p) => p.cargo.fecha_vencimiento <= fin && (!unidadId || p.cargo.unidad_negocio_id === unidadId))
      .map((p) => {
        const valor = (p.saldo * p.cargo.probabilidad_cobro) / 100;
        return Math.round(p.cargo.moneda === "USD" ? valor * cot : valor);
      }),
  );

  return {
    esperado,
    cobrado: sumar(empresa.filter((t) => t.tipo === "ingreso").map(enPesos)),
    gastado: 0 - sumar(empresa.filter((t) => t.tipo === "gasto" || t.tipo === "pago_deuda").map(enPesos)),
  };
}
