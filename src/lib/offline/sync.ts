/**
 * Motor de sincronización offline-first con Supabase.
 *
 * PUSH: toma los lotes de la `outbox` en orden y llama a la RPC
 *       `sincronizar_lote` (todo o nada, idempotente por id).
 *       - Error de red: se reintenta más tarde (el lote queda en la cola).
 *       - Rechazo del servidor (ej. mezcla de fondos): se marca con `error`
 *         y se muestra en "Para revisar"; no bloquea los demás lotes.
 * PULL: por tabla, trae filas con `actualizado_en` > cursor. No pisa filas
 *       que tienen cambios locales todavía sin subir.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { escribirMeta, leerMeta, TABLAS_SYNC, type CambioPendiente, type FamilianzasDB } from "./db";

let cliente: SupabaseClient | null | undefined;

/** null = modo demo (sin variables de entorno): solo datos locales. */
export function supabase(): SupabaseClient | null {
  if (cliente !== undefined) return cliente;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cliente = url && clave ? createClient(url, clave) : null;
  return cliente;
}

export interface EstadoSync {
  pendientes: number;
  rechazados: number;
  ultimoError?: string;
}

const LIMITE_PULL = 1000;
/** Margen para no perder filas de transacciones que confirmaron tarde. */
const SOLAPAMIENTO_MS = 60_000;

function esErrorDeRed(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e);
  return /fetch|network|Failed to fetch|timeout|ECONN/i.test(msg);
}

export async function subirPendientes(base: FamilianzasDB, sb: SupabaseClient): Promise<void> {
  const cola = await base.outbox.orderBy("seq").filter((c) => !c.error).toArray();
  const lotes = new Map<string, CambioPendiente[]>();
  for (const c of cola) lotes.set(c.lote, [...(lotes.get(c.lote) ?? []), c]);

  for (const [lote, cambios] of lotes) {
    const { error } = await sb.rpc("sincronizar_lote", {
      cambios: cambios.map((c) => ({ tabla: c.tabla, fila: c.fila })),
    });
    if (!error) {
      await base.outbox.where("lote").equals(lote).delete();
      continue;
    }
    if (esErrorDeRed(error)) throw error; // sin señal: se corta y se reintenta después
    // Rechazo de negocio: va a "Para revisar"
    await base.outbox
      .where("lote")
      .equals(lote)
      .modify((c) => {
        c.intentos += 1;
        c.error = error.message;
      });
  }
}

export async function bajarCambios(base: FamilianzasDB, sb: SupabaseClient): Promise<void> {
  const conCambiosLocales = new Set((await base.outbox.toArray()).map((c) => `${c.tabla}:${c.clave}`));

  for (const tabla of TABLAS_SYNC) {
    const claveCursor = `cursor:${tabla}`;
    let cursor = (await leerMeta(base, claveCursor)) ?? "1970-01-01T00:00:00Z";

    for (;;) {
      const desde = new Date(Date.parse(cursor) - SOLAPAMIENTO_MS).toISOString();
      const { data, error } = await sb
        .from(tabla)
        .select("*")
        .gt("actualizado_en", desde)
        .order("actualizado_en", { ascending: true })
        .limit(LIMITE_PULL);
      if (error) throw error;
      if (!data?.length) break;

      const pk = tabla === "config_embudo" ? "hogar_id" : "id";
      const aplicar = data.filter((f) => !conCambiosLocales.has(`${tabla}:${f[pk]}`));
      await base.table(tabla).bulkPut(aplicar);

      const ultimo = data[data.length - 1].actualizado_en as string;
      if (ultimo === cursor || data.length < LIMITE_PULL) {
        cursor = ultimo;
        break;
      }
      cursor = ultimo;
    }
    await escribirMeta(base, claveCursor, cursor);
  }
}

let enCurso: Promise<void> | null = null;

/** Sube y baja. Seguro de llamar muchas veces: no corre dos a la vez. */
export function sincronizar(base: FamilianzasDB): Promise<void> {
  const sb = supabase();
  if (!sb) return Promise.resolve();
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve();
  enCurso ??= (async () => {
    try {
      // La demo y los hogares sin vincular nunca se suben.
      if ((await leerMeta(base, "modo_demo")) === "1" || !(await leerMeta(base, "hogar_id"))) return;
      const { data } = await sb.auth.getSession();
      if (!data.session) return;
      await subirPendientes(base, sb);
      await bajarCambios(base, sb);
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

export async function estadoSync(base: FamilianzasDB): Promise<EstadoSync> {
  const cola = await base.outbox.toArray();
  const rechazados = cola.filter((c) => c.error);
  return {
    pendientes: new Set(cola.filter((c) => !c.error).map((c) => c.lote)).size,
    rechazados: new Set(rechazados.map((c) => c.lote)).size,
    ultimoError: rechazados.at(-1)?.error ?? undefined,
  };
}

/** Engancha la sync a los eventos del navegador. Devuelve la función para desengancharla. */
export function iniciarSyncAutomatica(base: FamilianzasDB, cadaMs = 60_000): () => void {
  const correr = () => void sincronizar(base).catch(() => undefined);
  window.addEventListener("online", correr);
  document.addEventListener("visibilitychange", correr);
  const intervalo = window.setInterval(correr, cadaMs);
  correr();
  return () => {
    window.removeEventListener("online", correr);
    document.removeEventListener("visibilitychange", correr);
    window.clearInterval(intervalo);
  };
}

/**
 * Descarta un lote rechazado por el servidor: lo saca de la cola, borra las
 * filas locales que creó y fuerza a volver a bajar todo para recuperar la
 * versión del servidor de lo que se haya editado.
 */
export async function descartarLote(base: FamilianzasDB, lote: string): Promise<void> {
  const cambios = await base.outbox.where("lote").equals(lote).toArray();
  await base.transaction("rw", [base.outbox, base.meta, ...cambios.map((c) => base.table(c.tabla))], async () => {
    for (const c of cambios) await base.table(c.tabla).delete(c.clave);
    await base.outbox.where("lote").equals(lote).delete();
    await base.meta.where("clave").startsWith("cursor:").delete();
  });
  void sincronizar(base).catch(() => undefined);
}

/** Vuelve a intentar un lote rechazado (por ejemplo, después de corregir datos). */
export async function reintentarLote(base: FamilianzasDB, lote: string): Promise<void> {
  await base.outbox.where("lote").equals(lote).modify((c) => { c.error = null; });
  void sincronizar(base).catch(() => undefined);
}
