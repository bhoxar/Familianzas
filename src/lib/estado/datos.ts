"use client";
/**
 * Hooks de lectura reactiva: la UI se redibuja sola cuando cambia la base
 * local (por una carga del usuario o por la sincronización).
 */
import { useLiveQuery } from "dexie-react-hooks";
import { db, leerMeta } from "../offline/db";
import { leerInstantanea } from "../offline/repositorio";
import { estadoSync } from "../offline/sync";
import { hoy } from "../dominio/utiles";

export function useHogarId(): string | null | undefined {
  return useLiveQuery(() => leerMeta(db(), "hogar_id"), []);
}

/** undefined = cargando; null = no hay hogar configurado. */
export function useInstantanea() {
  const hogarId = useHogarId();
  return useLiveQuery(
    async () => (hogarId ? leerInstantanea(db(), hogarId) : hogarId === null ? null : undefined),
    [hogarId],
  );
}

export function useEstadoSync() {
  return useLiveQuery(() => estadoSync(db()), [], { pendientes: 0, rechazados: 0 });
}

export function useEsDemo() {
  return useLiveQuery(async () => (await leerMeta(db(), "modo_demo")) === "1", [], false);
}

export const useHoy = () => hoy();
