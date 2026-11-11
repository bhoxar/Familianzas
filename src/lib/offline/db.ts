/**
 * Base de datos LOCAL del teléfono (IndexedDB vía Dexie).
 *
 * - Cada tabla guarda las MISMAS filas que Postgres (ver lib/dominio/tipos.ts).
 * - `outbox`: cola de cambios hechos sin señal. Cada cambio pertenece a un
 *   `lote` que se envía entero a `sincronizar_lote()` (todo o nada).
 * - `meta`: cursores de sincronización, id del dispositivo, hogar actual.
 */
import Dexie, { type Table } from "dexie";
import type {
  Asignacion,
  Cargo,
  CobroAplicado,
  ConfigEmbudo,
  Cotizacion,
  Cuenta,
  DeudaPropia,
  Deudor,
  EmbudoDistribucion,
  Hogar,
  ReglaEmbudo,
  Sobre,
  Transaccion,
  UnidadNegocio,
} from "../dominio/tipos";

/** Tablas que se sincronizan, EN ORDEN DE DEPENDENCIAS (padres primero). */
export const TABLAS_SYNC = [
  "unidades_negocio",
  "cuentas",
  "sobres",
  "deudores",
  "cargos",
  "deudas_propias",
  "reglas_embudo",
  "config_embudo",
  "cotizaciones",
  "transacciones",
  "asignaciones",
  "cobros_aplicados",
  "embudo_distribuciones",
] as const;
export type TablaSync = (typeof TABLAS_SYNC)[number];

export interface CambioPendiente {
  seq?: number;
  lote: string;
  tabla: TablaSync;
  /** Clave primaria de la fila (id, o hogar_id en config_embudo). */
  clave: string;
  fila: Record<string, unknown>;
  creado_en: string;
  intentos: number;
  /** Si el servidor rechazó el lote: motivo en texto para "Para revisar". */
  error?: string | null;
}

export interface Meta {
  clave: string;
  valor: string;
}

export class FamilianzasDB extends Dexie {
  hogares!: Table<Hogar, string>;
  unidades_negocio!: Table<UnidadNegocio, string>;
  cuentas!: Table<Cuenta, string>;
  sobres!: Table<Sobre, string>;
  asignaciones!: Table<Asignacion, string>;
  transacciones!: Table<Transaccion, string>;
  deudores!: Table<Deudor, string>;
  cargos!: Table<Cargo, string>;
  cobros_aplicados!: Table<CobroAplicado, string>;
  cotizaciones!: Table<Cotizacion, string>;
  deudas_propias!: Table<DeudaPropia, string>;
  reglas_embudo!: Table<ReglaEmbudo, string>;
  embudo_distribuciones!: Table<EmbudoDistribucion, string>;
  config_embudo!: Table<ConfigEmbudo, string>;
  outbox!: Table<CambioPendiente, number>;
  meta!: Table<Meta, string>;

  constructor(nombre = "familianzas") {
    super(nombre);
    this.version(1).stores({
      hogares: "id",
      unidades_negocio: "id, hogar_id",
      cuentas: "id, hogar_id, ambito",
      sobres: "id, hogar_id, ambito",
      asignaciones: "id, hogar_id, sobre_id, mes",
      transacciones: "id, hogar_id, ambito, cuenta_id, fecha, grupo_id",
      deudores: "id, hogar_id",
      cargos: "id, hogar_id, deudor_id, estado",
      cobros_aplicados: "id, hogar_id, cargo_id",
      cotizaciones: "id, fecha",
      deudas_propias: "id, hogar_id",
      reglas_embudo: "id, hogar_id, orden",
      embudo_distribuciones: "id, hogar_id, mes, transaccion_ingreso_id",
      config_embudo: "hogar_id",
      outbox: "++seq, lote, tabla, clave",
      meta: "clave",
    });
  }
}

let instancia: FamilianzasDB | null = null;

/** Singleton para la app. Los tests crean su propia instancia. */
export function db(): FamilianzasDB {
  if (!instancia) instancia = new FamilianzasDB();
  return instancia;
}

export async function leerMeta(base: FamilianzasDB, clave: string): Promise<string | null> {
  return (await base.meta.get(clave))?.valor ?? null;
}

export async function escribirMeta(base: FamilianzasDB, clave: string, valor: string): Promise<void> {
  await base.meta.put({ clave, valor });
}

/** Id estable de este teléfono, para trazar quién cargó qué. */
export async function idDispositivo(base: FamilianzasDB): Promise<string> {
  let id = await leerMeta(base, "dispositivo_id");
  if (!id) {
    id = crypto.randomUUID();
    await escribirMeta(base, "dispositivo_id", id);
  }
  return id;
}
