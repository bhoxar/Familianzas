"use client";
/**
 * Arranque y sesión. La app tiene tres formas de uso:
 *  - DEMO: datos ficticios, solo en el teléfono, nunca se suben.
 *  - LOCAL: datos reales solo en este teléfono (si no se configuró Supabase).
 *  - COMPARTIDA: con Supabase; ambos cónyuges ven el mismo hogar y se sincroniza.
 */
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/supabase-js";
import { db, escribirMeta, leerMeta, type FamilianzasDB } from "../offline/db";
import { guardarLote, leerInstantanea } from "../offline/repositorio";
import { sincronizar, supabase } from "../offline/sync";
import { armarConfiguracionInicial, type RespuestasIniciales } from "../dominio/configuracion";
import { cargarDemo } from "../demo/cargar";
import { ahoraISO, hoy, nuevoId } from "../dominio/utiles";

export type EstadoArranque = "cargando" | "sin_sesion" | "sin_hogar" | "sin_configurar" | "listo";

/** Borra todos los datos locales (al salir de la demo o cerrar sesión). */
export async function borrarDatosLocales(base: FamilianzasDB = db()) {
  await base.transaction("rw", base.tables, async () => {
    await Promise.all(base.tables.map((t) => t.clear()));
  });
}

export async function verDemo(base: FamilianzasDB = db()) {
  await cargarDemo(base, hoy());
}

/** Sale de la demo para empezar con datos propios. */
export async function salirDeDemo(base: FamilianzasDB = db()) {
  await borrarDatosLocales(base);
  await escribirMeta(base, "demo_descartada", "1");
}

/** Hogar solo en este teléfono (sin Supabase). */
export async function crearHogarLocal(nombre: string, base: FamilianzasDB = db()): Promise<string> {
  const id = nuevoId();
  const m = ahoraISO();
  await base.hogares.put({ id, nombre: nombre.trim() || "Mi hogar", moneda_base: "ARS", estrategia_deuda: "avalancha", creado_en: m, actualizado_en: m });
  await base.config_embudo.put({ hogar_id: id, modo: "forzar", sobre_sueldo_id: null, cuenta_familia_id: null, actualizado_en: m });
  await escribirMeta(base, "hogar_id", id);
  await escribirMeta(base, "modo_demo", "0");
  return id;
}

async function despuesDeVincular(base: FamilianzasDB, hogarId: string) {
  await escribirMeta(base, "hogar_id", hogarId);
  await escribirMeta(base, "modo_demo", "0");
  await sincronizar(base); // trae el hogar, la config y lo que haya cargado el otro cónyuge
}

export async function crearHogarCompartido(nombre: string, tuNombre: string, base: FamilianzasDB = db()) {
  const sb = supabase();
  if (!sb) throw new Error("Supabase no está configurado");
  const { data, error } = await sb.rpc("crear_hogar", { p_nombre: nombre, p_nombre_usuario: tuNombre });
  if (error) throw new Error(error.message);
  await despuesDeVincular(base, data as string);
}

export async function unirseAHogar(codigo: string, tuNombre: string, base: FamilianzasDB = db()) {
  const sb = supabase();
  if (!sb) throw new Error("Supabase no está configurado");
  const { data, error } = await sb.rpc("unirse_hogar", { p_codigo: codigo, p_nombre_usuario: tuNombre });
  if (error) throw new Error(error.message);
  await despuesDeVincular(base, data as string);
}

/** Guarda la configuración inicial en un solo lote. */
export async function aplicarConfiguracionInicial(respuestas: RespuestasIniciales, base: FamilianzasDB = db()) {
  const hogarId = await leerMeta(base, "hogar_id");
  if (!hogarId) throw new Error("No hay hogar");
  const f = armarConfiguracionInicial(hogarId, respuestas);
  await guardarLote(base, [
    ...f.unidades.map((x) => ({ tabla: "unidades_negocio" as const, fila: { ...x } })),
    ...f.cuentas.map((x) => ({ tabla: "cuentas" as const, fila: { ...x } })),
    ...f.sobres.map((x) => ({ tabla: "sobres" as const, fila: { ...x } })),
    ...f.deudas.map((x) => ({ tabla: "deudas_propias" as const, fila: { ...x } })),
    ...f.reglas.map((x) => ({ tabla: "reglas_embudo" as const, fila: { ...x } })),
    { tabla: "config_embudo" as const, fila: { ...f.config } },
  ]);
  void sincronizar(base).catch(() => undefined);
}

export async function enviarEnlaceAcceso(email: string) {
  const sb = supabase();
  if (!sb) throw new Error("Supabase no está configurado");
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) throw new Error(error.message);
}

/**
 * Entrar con el código de 6 dígitos del mail (alternativa al enlace).
 * Sirve cuando el mail se abre en otro navegador o con la app instalada
 * (en iPhone el enlace abre Safari, no la app de la pantalla de inicio).
 */
export async function verificarCodigo(email: string, codigo: string) {
  const sb = supabase();
  if (!sb) throw new Error("Supabase no está configurado");
  const { error } = await sb.auth.verifyOtp({ email, token: codigo.trim(), type: "email" });
  if (error) throw new Error("El código no es válido o venció. Pedí uno nuevo.");
}

export async function cerrarSesion(base: FamilianzasDB = db()) {
  const pendientes = await base.outbox.count();
  if (pendientes > 0) {
    await sincronizar(base).catch(() => undefined);
    if ((await base.outbox.count()) > 0) {
      throw new Error("Hay movimientos sin subir. Conectate a internet antes de cerrar sesión para no perderlos.");
    }
  }
  await supabase()?.auth.signOut();
  await borrarDatosLocales(base);
}

export async function codigoInvitacion(): Promise<string | null> {
  const base = db();
  const hogarId = await leerMeta(base, "hogar_id");
  const h = hogarId ? ((await base.hogares.get(hogarId)) as { codigo_invitacion?: string } | undefined) : undefined;
  return h?.codigo_invitacion ?? null;
}

/** Sesión de Supabase (null si no hay o no está configurado). */
export function useSesion(): Session | null | undefined {
  const [sesion, setSesion] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const sb = supabase();
    if (!sb) {
      setSesion(null);
      return;
    }
    void sb.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return sesion;
}

/**
 * Determina en qué estado está la app y hace el arranque necesario:
 * carga la demo la primera vez (sin Supabase) y vincula la sesión con su hogar.
 */
export function useArranque(): EstadoArranque {
  const sesion = useSesion();
  const meta = useLiveQuery(async () => {
    const base = db();
    const hogarId = await leerMeta(base, "hogar_id");
    return {
      hogarId,
      demo: (await leerMeta(base, "modo_demo")) === "1",
      demoDescartada: (await leerMeta(base, "demo_descartada")) === "1",
      configurado: hogarId ? (await base.cuentas.where("hogar_id").equals(hogarId).count()) > 0 : false,
    };
  }, []);
  const [vinculando, setVinculando] = useState(false);
  const conSupabase = !!supabase();

  // Sin Supabase: la primera vez se muestra la demo.
  useEffect(() => {
    if (!meta || conSupabase || meta.hogarId || meta.demoDescartada) return;
    void verDemo();
  }, [meta, conSupabase]);

  // Con sesión: buscar el hogar del usuario en el servidor.
  useEffect(() => {
    const sb = supabase();
    if (!sb || !sesion || !meta || meta.demo || vinculando) return;
    let cancelado = false;
    setVinculando(true);
    void (async () => {
      try {
        const { data } = await sb.from("usuarios").select("hogar_id").eq("id", sesion.user.id).maybeSingle();
        if (cancelado || !data?.hogar_id) return;
        if (meta.hogarId && meta.hogarId !== data.hogar_id) await borrarDatosLocales();
        if (meta.hogarId !== data.hogar_id) await despuesDeVincular(db(), data.hogar_id);
      } finally {
        if (!cancelado) setVinculando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion?.user.id, meta?.hogarId, meta?.demo]);

  if (!meta || sesion === undefined) return "cargando";
  if (meta.demo) return "listo";
  if (conSupabase && !sesion) return "sin_sesion";
  if (!meta.hogarId) return conSupabase && vinculando ? "cargando" : "sin_hogar";
  if (!meta.configurado) return "sin_configurar";
  return "listo";
}

export async function hogarActual() {
  const base = db();
  const id = await leerMeta(base, "hogar_id");
  return id ? leerInstantanea(base, id) : null;
}
