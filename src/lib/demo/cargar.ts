import type { FamilianzasDB } from "../offline/db";
import { escribirMeta } from "../offline/db";
import { crearDemo, HOGAR_DEMO } from "./datos-demo";

/**
 * Carga los datos de demostración en la base local (sin pasar por la cola de
 * sincronización: la demo nunca se sube a ningún servidor).
 */
export async function cargarDemo(base: FamilianzasDB, hoy: string): Promise<string> {
  const s = crearDemo(hoy);
  await base.transaction("rw", base.tables, async () => {
    await Promise.all(base.tables.map((t) => t.clear()));
    await base.hogares.put(s.hogar);
    await base.unidades_negocio.bulkPut(s.unidades);
    await base.cuentas.bulkPut(s.cuentas);
    await base.sobres.bulkPut(s.sobres);
    await base.asignaciones.bulkPut(s.asignaciones);
    await base.transacciones.bulkPut(s.transacciones);
    await base.deudores.bulkPut(s.deudores);
    await base.cargos.bulkPut(s.cargos);
    await base.cobros_aplicados.bulkPut(s.cobros);
    await base.cotizaciones.bulkPut(s.cotizaciones);
    await base.deudas_propias.bulkPut(s.deudas);
    await base.reglas_embudo.bulkPut(s.reglas);
    await base.embudo_distribuciones.bulkPut(s.distribuciones);
    if (s.config) await base.config_embudo.put(s.config);
    await escribirMeta(base, "hogar_id", HOGAR_DEMO);
    await escribirMeta(base, "modo_demo", "1");
  });
  return HOGAR_DEMO;
}
