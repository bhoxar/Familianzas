/**
 * Presupuesto base cero ("cada peso tiene un trabajo").
 * Lógica pura: qué asignaciones crear para repartir la plata sin destino.
 */
import type { Ambito, Centavos, Fecha, Sobre } from "./tipos";
import type { SaldoSobre } from "./calculos";

export interface PropuestaReparto {
  sobre: Sobre;
  monto: Centavos;
  /** Por qué recibe ese monto. */
  motivo: string;
}

/** Tipos de sobre que el reparto automático llena. El de sueldo lo llena solo el Embudo. */
const REPARTIBLES = new Set(["gasto_mensual", "costo_fijo", "deuda", "fondo_emergencia", "ahorro", "inversion", "impuestos"]);

/**
 * Lo que le falta a un sobre este mes para cumplir su necesidad mensual.
 * - meta_mensual: lo que necesita por mes (descontando lo ya asignado este mes).
 * - Si se pasó de gasto (disponible negativo), primero se cubre el rojo.
 */
export function faltaEsteMes(x: SaldoSobre): Centavos {
  const rojo = x.disponible < 0 ? -x.disponible : 0;
  const necesidad = x.sobre.meta_mensual ? Math.max(x.sobre.meta_mensual - x.asignadoMes, 0) : 0;
  // Una meta total (fondo de emergencia) no se pasa de su objetivo.
  const topeMeta = x.sobre.meta_monto != null ? Math.max(x.sobre.meta_monto - Math.max(x.disponible, 0), 0) : Infinity;
  return Math.max(rojo, Math.min(necesidad, topeMeta));
}

/**
 * Reparte `disponible` entre los sobres del ámbito por prioridad (1 = primero).
 * Nunca asigna más de lo que hay: es el corazón del "no proyectar plata que no existe".
 */
export function proponerReparto(sobres: SaldoSobre[], ambito: Ambito, disponible: Centavos): PropuestaReparto[] {
  if (disponible <= 0) return [];
  let restante = disponible;
  const out: PropuestaReparto[] = [];
  const candidatos = sobres
    .filter((x) => x.sobre.ambito === ambito && REPARTIBLES.has(x.sobre.tipo))
    .sort((a, b) => a.sobre.prioridad - b.sobre.prioridad || a.sobre.orden - b.sobre.orden);

  for (const x of candidatos) {
    if (restante <= 0) break;
    const falta = faltaEsteMes(x);
    if (falta <= 0) continue;
    const monto = Math.min(falta, restante);
    out.push({ sobre: x.sobre, monto, motivo: x.disponible < 0 ? "Cubrir lo gastado de más" : "Lo que necesita este mes" });
    restante -= monto;
  }
  return out;
}

export function mesDe(fecha: Fecha): Fecha {
  return `${fecha.slice(0, 7)}-01`;
}
