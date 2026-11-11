import type { Centavos, Fecha } from "./tipos";

// ---------------------------------------------------------------------------
// Dinero
// ---------------------------------------------------------------------------
const formatoARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const formatoUSD = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "symbol",
  maximumFractionDigits: 0,
});

/** 12345600 -> "$ 123.456" */
export function pesos(centavos: Centavos): string {
  return formatoARS.format(Math.round(centavos / 100));
}

/** 30000 -> "US$ 300" */
export function dolares(centavos: Centavos): string {
  return formatoUSD.format(Math.round(centavos / 100));
}

/** "1.500,50" | "1500" | "1500.5" -> centavos */
export function aCentavos(texto: string): Centavos {
  const limpio = texto.replace(/\s|\$/g, "");
  const normal = limpio.includes(",")
    ? limpio.replace(/\./g, "").replace(",", ".")
    : limpio;
  const n = Number(normal);
  if (!Number.isFinite(n)) throw new Error(`Monto inválido: ${texto}`);
  return Math.round(n * 100);
}

/** Convierte centavos de USD a centavos de ARS con una cotización (pesos por dólar). */
export function usdAPesos(centavosUsd: Centavos, cotizacion: number): Centavos {
  return Math.round(centavosUsd * cotizacion);
}

// ---------------------------------------------------------------------------
// Fechas (siempre en hora local del dispositivo)
// ---------------------------------------------------------------------------
export function hoy(ahora: Date = new Date()): Fecha {
  const a = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, "0");
  const d = String(ahora.getDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

/** '2026-11-17' -> '2026-11-01' */
export function inicioDeMes(fecha: Fecha): Fecha {
  return `${fecha.slice(0, 7)}-01`;
}

/** Último día del mes de la fecha. */
export function finDeMes(fecha: Fecha): Fecha {
  const [a, m] = fecha.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${fecha.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

/** Días entre dos fechas (b - a). */
export function diasEntre(a: Fecha, b: Fecha): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function sumarDias(fecha: Fecha, dias: number): Fecha {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const nombreMes = (fecha: Fecha) =>
  new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", { month: "long" });

// ---------------------------------------------------------------------------
// Ids y marcas de tiempo
// ---------------------------------------------------------------------------
export const nuevoId = (): string => crypto.randomUUID();
export const ahoraISO = (): string => new Date().toISOString();

/** Filtra filas con borrado lógico. */
export const vivos = <T extends { eliminado_en?: string | null }>(filas: T[]): T[] =>
  filas.filter((f) => !f.eliminado_en);

export const sumar = (valores: number[]): number => valores.reduce((a, b) => a + b, 0);
