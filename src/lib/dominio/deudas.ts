/**
 * Deudas: estado actual, orden de pago y simulador de salida.
 *
 * - Avalancha: primero la de MAYOR interés (ahorra más plata).
 * - Bola de nieve: primero la de MENOR saldo (victorias rápidas, motiva).
 * En ambas se paga el mínimo de todas y el "extra" va a la primera de la lista;
 * cuando una se cancela, su cuota se suma al extra (efecto bola de nieve).
 */
import type { Centavos, DeudaPropia, EstrategiaDeuda, Transaccion } from "./tipos";
import { sumar, vivos } from "./utiles";

export interface EstadoDeuda {
  deuda: DeudaPropia;
  saldo: Centavos;
  pagado: Centavos;
  cuotasRestantes: number | null;
  interesMensual: Centavos;
}

export function estadoDeudas(deudas: DeudaPropia[], transacciones: Transaccion[]): EstadoDeuda[] {
  const pagos = vivos(transacciones).filter((t) => t.tipo === "pago_deuda" && t.deuda_id);
  return vivos(deudas)
    .filter((d) => !d.cancelada)
    .map((deuda) => {
      const propios = pagos.filter((t) => t.deuda_id === deuda.id);
      const pagado = 0 - sumar(propios.map((t) => t.monto));
      const saldo = Math.max(deuda.saldo_inicial - pagado, 0);
      return {
        deuda,
        saldo,
        pagado,
        cuotasRestantes:
          deuda.cuotas_total != null ? Math.max(deuda.cuotas_total - deuda.cuotas_pagadas_al_cargar - propios.length, 0) : null,
        interesMensual: Math.round((saldo * deuda.tasa_anual) / 100 / 12),
      };
    });
}

export function ordenarDeudas(estados: EstadoDeuda[], estrategia: EstrategiaDeuda): EstadoDeuda[] {
  return [...estados].sort((a, b) => {
    const ma = a.deuda.orden_manual ?? Infinity;
    const mb = b.deuda.orden_manual ?? Infinity;
    if (ma !== mb) return ma - mb;
    if (estrategia === "avalancha") return b.deuda.tasa_anual - a.deuda.tasa_anual || a.saldo - b.saldo;
    return a.saldo - b.saldo || b.deuda.tasa_anual - a.deuda.tasa_anual;
  });
}

export interface ResultadoSimulacion {
  meses: number;
  interesesTotales: Centavos;
  /** Mes (1..n) en que se cancela cada deuda. */
  cancelacion: Record<string, number>;
  /** true si con esos pagos la deuda no baja nunca (el mínimo no cubre el interés). */
  sinSalida: boolean;
}

/**
 * Simula mes a mes. `extraMensual` = lo que se agrega a los mínimos.
 * Las deudas en cuotas sin interés (plan de ahorro) se pagan solo con su cuota.
 */
export function simularSalida(
  estados: EstadoDeuda[],
  estrategia: EstrategiaDeuda,
  extraMensual: Centavos,
  maxMeses = 600,
): ResultadoSimulacion {
  const orden = ordenarDeudas(estados, estrategia);
  const saldos = new Map(orden.map((e) => [e.deuda.id, e.saldo]));
  const cancelacion: Record<string, number> = {};
  let intereses = 0;
  let mes = 0;

  for (const e of orden) if (e.saldo <= 0) cancelacion[e.deuda.id] = 0;

  while ([...saldos.values()].some((s) => s > 0) && mes < maxMeses) {
    mes++;
    // 1. Interés del mes
    for (const e of orden) {
      const s = saldos.get(e.deuda.id)!;
      if (s <= 0) continue;
      const i = Math.round((s * e.deuda.tasa_anual) / 100 / 12);
      intereses += i;
      saldos.set(e.deuda.id, s + i);
    }
    // 2. Mínimos; lo de las deudas ya canceladas se suma al extra
    let extra = extraMensual;
    for (const e of orden) {
      const s = saldos.get(e.deuda.id)!;
      const minimo = e.deuda.pago_minimo;
      if (s <= 0) {
        extra += minimo;
        continue;
      }
      const pago = Math.min(minimo, s);
      saldos.set(e.deuda.id, s - pago);
      extra += minimo - pago;
    }
    // 3. Extra a la primera deuda viva según la estrategia (las de interés 0 en cuotas no se adelantan)
    for (const e of orden) {
      if (extra <= 0) break;
      const s = saldos.get(e.deuda.id)!;
      if (s <= 0 || (e.deuda.tasa_anual === 0 && e.deuda.cuotas_total)) continue;
      const pago = Math.min(extra, s);
      saldos.set(e.deuda.id, s - pago);
      extra -= pago;
    }
    for (const e of orden) {
      if (saldos.get(e.deuda.id)! <= 0 && cancelacion[e.deuda.id] == null) cancelacion[e.deuda.id] = mes;
    }
  }

  return {
    meses: mes,
    interesesTotales: intereses,
    cancelacion,
    sinSalida: [...saldos.values()].some((s) => s > 0),
  };
}
