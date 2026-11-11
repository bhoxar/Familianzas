/**
 * Modelo de datos de Familianzas.
 *
 * Espejo 1:1 de las tablas de `supabase/migrations/0001_esquema_inicial.sql`.
 * Los nombres de campos se mantienen en snake_case a propósito: la base local
 * (Dexie / IndexedDB) guarda las MISMAS filas que Postgres, así la
 * sincronización las copia sin traducir.
 *
 * Convenciones:
 *  - Montos en CENTAVOS (number entero). $1.500,50 => 150050.
 *  - Fechas "date" como 'YYYY-MM-DD'; timestamps como ISO 8601.
 *  - Ids uuid generados en el dispositivo (offline-first).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enumerados
// ---------------------------------------------------------------------------
export const AMBITOS = ["empresa", "familia"] as const;
export type Ambito = (typeof AMBITOS)[number];

export type Moneda = "ARS" | "USD";
export type TipoUnidad = "pensionado" | "alimento" | "cabanas" | "otro";
export type TipoCuenta = "efectivo" | "banco" | "billetera_virtual" | "tarjeta_credito";
export type TipoTransaccion =
  | "ingreso"
  | "gasto"
  | "transferencia"
  | "sueldo"
  | "aporte_capital"
  | "pago_deuda"
  | "ajuste";
export type EstadoCargo = "pendiente" | "parcial" | "pagado" | "incobrable" | "anulado";
export type TipoSobre =
  | "gasto_mensual"
  | "costo_fijo"
  | "fondo_emergencia"
  | "ahorro"
  | "inversion"
  | "impuestos"
  | "deuda"
  | "sueldo";
export type EstrategiaDeuda = "avalancha" | "bola_de_nieve";
export type TipoDeuda =
  | "prestamo"
  | "tarjeta"
  | "compra_en_cuotas"
  | "plan_ahorro"
  | "proveedor"
  | "otro";
export type DestinoRegla = "sobre" | "sueldo";
export type Semaforo = "al_dia" | "gracia" | "atrasado" | "moroso" | "critico";

/** Centavos. Alias documental: siempre entero. */
export type Centavos = number;
/** 'YYYY-MM-DD' */
export type Fecha = string;

// ---------------------------------------------------------------------------
// Campos comunes de sincronización
// ---------------------------------------------------------------------------
export interface Sincronizable {
  id: string;
  hogar_id: string;
  creado_en: string;
  actualizado_en: string;
  eliminado_en?: string | null;
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------
export interface Hogar {
  id: string;
  nombre: string;
  moneda_base: Moneda;
  estrategia_deuda: EstrategiaDeuda;
  creado_en: string;
  actualizado_en: string;
}

export interface Usuario {
  id: string;
  hogar_id: string;
  nombre: string;
  rol: "admin" | "miembro" | "lector";
  modo_preferido: Ambito;
}

export interface UnidadNegocio extends Sincronizable {
  nombre: string;
  tipo: TipoUnidad;
  activa: boolean;
  fecha_inicio?: Fecha | null;
  color?: string | null;
}

export interface Cuenta extends Sincronizable {
  ambito: Ambito;
  unidad_negocio_id?: string | null;
  nombre: string;
  tipo: TipoCuenta;
  moneda: Moneda;
  saldo_inicial: Centavos;
  /** Solo tarjetas: la usan negocio y familia; cada movimiento toma el ámbito de su sobre. */
  compartida: boolean;
  dia_cierre?: number | null;
  dia_vencimiento?: number | null;
  archivada: boolean;
}

export interface Cotizacion {
  id: string;
  hogar_id?: string | null;
  fecha: Fecha;
  tipo: string; // 'blue'
  compra: number;
  venta: number;
  /** (compra + venta) / 2 — criterio dolarhoy.com. Columna generada en Postgres. */
  promedio: number;
  fuente: "automatica" | "manual";
}

export interface Sobre extends Sincronizable {
  ambito: Ambito;
  unidad_negocio_id?: string | null;
  nombre: string;
  tipo: TipoSobre;
  grupo?: string | null;
  meta_monto?: Centavos | null;
  meta_mensual?: Centavos | null;
  meta_fecha?: Fecha | null;
  prioridad: number;
  orden: number;
}

export interface Asignacion extends Sincronizable {
  sobre_id: string;
  /** Primer día del mes: 'YYYY-MM-01' */
  mes: Fecha;
  /** Positivo = darle plata al sobre; negativo = sacarle. */
  monto: Centavos;
  nota?: string | null;
  creado_por?: string | null;
}

export interface Deudor extends Sincronizable {
  unidad_negocio_id: string;
  nombre: string;
  telefono?: string | null;
  notas?: string | null;
  tarifa_mensual?: Centavos | null;
  cantidad_unidades?: number | null;
  dia_vencimiento?: number | null;
  dias_gracia: number;
  activo: boolean;
}

export interface Cargo extends Sincronizable {
  unidad_negocio_id: string;
  deudor_id: string;
  concepto: string;
  periodo?: Fecha | null;
  moneda: Moneda;
  monto: Centavos;
  fecha_emision: Fecha;
  fecha_vencimiento: Fecha;
  probabilidad_cobro: number;
  estado: EstadoCargo;
  reserva_desde?: Fecha | null;
  reserva_hasta?: Fecha | null;
}

export interface DeudaPropia extends Sincronizable {
  ambito: Ambito;
  unidad_negocio_id?: string | null;
  tipo: TipoDeuda;
  acreedor: string;
  descripcion?: string | null;
  moneda: Moneda;
  monto_original: Centavos;
  saldo_inicial: Centavos;
  /** TNA en % (85.5 = 85,5% anual). */
  tasa_anual: number;
  pago_minimo: Centavos;
  cuotas_total?: number | null;
  cuotas_pagadas_al_cargar: number;
  dia_vencimiento?: number | null;
  cuenta_tarjeta_id?: string | null;
  sobre_id?: string | null;
  orden_manual?: number | null;
  cancelada: boolean;
}

export interface ConfigEmbudo {
  hogar_id: string;
  modo: "sugerir" | "forzar";
  /** Sobre de EMPRESA tipo 'sueldo' ("Sueldo por transferir"). */
  sobre_sueldo_id: string | null;
  /** Cuenta familiar donde suele depositarse el sueldo. */
  cuenta_familia_id: string | null;
  actualizado_en: string;
}

export interface ReglaEmbudo extends Sincronizable {
  orden: number;
  nombre: string;
  destino: DestinoRegla;
  /** Sobre de EMPRESA a llenar. En reglas 'sueldo' es el sobre "Sueldo por transferir". */
  sobre_id?: string | null;
  tope_mensual: Centavos;
  /** Máximo % de CADA ingreso que puede tomar esta regla (opcional). */
  porcentaje_max?: number | null;
  /** null = aplica a ingresos de cualquier unidad. */
  unidad_negocio_id?: string | null;
  activa: boolean;
}

export interface Transaccion extends Sincronizable {
  cuenta_id: string;
  /** Lo fija la base de datos a partir de la cuenta/sobre; el cliente lo calcula igual para la vista offline. */
  ambito: Ambito;
  unidad_negocio_id?: string | null;
  tipo: TipoTransaccion;
  fecha: Fecha;
  /** + entra a la cuenta, − sale. */
  monto: Centavos;
  descripcion?: string | null;
  sobre_id?: string | null;
  es_costo_fijo?: boolean;
  grupo_id?: string | null;
  deuda_id?: string | null;
  moneda_original?: Moneda | null;
  monto_original?: Centavos | null;
  tipo_cambio?: number | null;
  creado_por?: string | null;
  dispositivo_id?: string | null;
}

export interface CobroAplicado extends Sincronizable {
  transaccion_id: string;
  cargo_id: string;
  /** En la moneda del cargo. */
  monto: Centavos;
}

export interface EmbudoDistribucion extends Sincronizable {
  transaccion_ingreso_id: string;
  regla_id: string;
  mes: Fecha;
  monto: Centavos;
  asignacion_id?: string | null;
}

// ---------------------------------------------------------------------------
// Validaciones de entrada (formularios + cola offline)
// ---------------------------------------------------------------------------
export const esquemaCentavos = z.number().int().safe();
/** Ids: uuid en producción (lo exige Postgres); la demo usa ids legibles. */
const esquemaId = z.string().min(1).max(64);

export const esquemaNuevaTransaccion = z.object({
  cuenta_id: esquemaId,
  tipo: z.enum(["ingreso", "gasto", "pago_deuda", "ajuste"]),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monto: esquemaCentavos.refine((m) => m !== 0, "El monto no puede ser 0"),
  descripcion: z.string().max(200).optional(),
  sobre_id: esquemaId.nullish(),
  unidad_negocio_id: esquemaId.nullish(),
  deuda_id: esquemaId.nullish(),
  ambito: z.enum(AMBITOS).optional(),
});
export type NuevaTransaccion = z.infer<typeof esquemaNuevaTransaccion>;

export const esquemaReglaEmbudo = z.object({
  nombre: z.string().min(1).max(60),
  destino: z.enum(["sobre", "sueldo"]),
  sobre_id: esquemaId.nullish(),
  tope_mensual: esquemaCentavos.positive(),
  porcentaje_max: z.number().gt(0).lte(100).nullish(),
  unidad_negocio_id: esquemaId.nullish(),
});
