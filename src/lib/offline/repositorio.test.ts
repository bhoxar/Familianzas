import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FamilianzasDB } from "./db";
import { confirmarSueldo, leerInstantanea, registrarMovimiento, reordenarReglas } from "./repositorio";
import { subirPendientes } from "./sync";
import { cargarDemo } from "../demo/cargar";
import { HOGAR_DEMO } from "../demo/datos-demo";
import { estadoEmbudoMes } from "../dominio/embudo";
import { ErrorSeparacion, plataSinDestino } from "../dominio/calculos";
import type { SupabaseClient } from "@supabase/supabase-js";

const HOY = "2026-11-11";
let base: FamilianzasDB;

beforeEach(async () => {
  base = new FamilianzasDB(`test-${crypto.randomUUID()}`);
  await cargarDemo(base, HOY);
});

const instantanea = async () => (await leerInstantanea(base, HOGAR_DEMO))!;

describe("repositorio offline", () => {
  it("un ingreso del negocio se reparte con el Embudo y queda TODO en un mismo lote", async () => {
    const s = await instantanea();
    const antes = estadoEmbudoMes(s.reglas, s.distribuciones, HOY);
    const { transaccion, embudo } = await registrarMovimiento(base, s, {
      cuenta_id: "c-banco-neg", tipo: "ingreso", fecha: HOY, monto: 300_000_00, unidad_negocio_id: "u-pension",
    });
    expect(transaccion).toMatchObject({ ambito: "empresa", monto: 300_000_00 });
    expect(embudo!.pasos.reduce((a, p) => a + p.monto, 0) + embudo!.sobrante).toBe(300_000_00);

    const cola = await base.outbox.toArray();
    expect(new Set(cola.map((c) => c.lote)).size).toBe(1);
    expect(cola.map((c) => c.tabla)).toEqual([
      "transacciones",
      ...embudo!.asignaciones.map(() => "asignaciones"),
      ...embudo!.distribuciones.map(() => "embudo_distribuciones"),
    ]);
    const despues = estadoEmbudoMes((await instantanea()).reglas, (await instantanea()).distribuciones, HOY);
    expect(despues.reduce((a, e) => a + e.cubierto, 0) - antes.reduce((a, e) => a + e.cubierto, 0)).toBe(
      300_000_00 - embudo!.sobrante,
    );
  });

  it("un gasto que mezcla fondos se rechaza sin escribir nada", async () => {
    const s = await instantanea();
    await expect(
      registrarMovimiento(base, s, { cuenta_id: "c-banco-neg", tipo: "gasto", fecha: HOY, monto: 1000, sobre_id: "s-super" }),
    ).rejects.toThrow(ErrorSeparacion);
    expect(await base.outbox.count()).toBe(0);
  });

  it("gasto con la Visa compartida toma el ámbito del sobre", async () => {
    const s = await instantanea();
    const { transaccion, embudo } = await registrarMovimiento(base, s, {
      cuenta_id: "c-visa", tipo: "gasto", fecha: HOY, monto: 15_000_00, sobre_id: "s-nafta",
    });
    expect(transaccion).toMatchObject({ ambito: "empresa", monto: -15_000_00, unidad_negocio_id: "u-alimento" });
    expect(embudo).toBeNull();
  });

  it("confirmar sueldo mueve plata de Negocio a Familia sin alterar la plata sin destino del negocio", async () => {
    const s = await instantanea();
    const lpaAntes = plataSinDestino(s, "empresa", HOY).monto;
    const [sale, entra] = await confirmarSueldo(base, s, { monto: 10_000_00, cuentaEmpresaId: "c-banco-neg" });
    expect(sale.monto + entra.monto).toBe(0);
    const s2 = await instantanea();
    // La plata ya estaba bloqueada en el sobre de sueldo: el negocio no pierde plata "libre".
    expect(plataSinDestino(s2, "empresa", HOY).monto).toBe(lpaAntes);
    expect(plataSinDestino(s2, "familia", HOY).monto).toBe(plataSinDestino(s, "familia", HOY).monto + 10_000_00);
  });

  it("reordenar la cascada solo guarda las reglas que cambiaron", async () => {
    const s = await instantanea();
    const ids = s.reglas.sort((a, b) => a.orden - b.orden).map((r) => r.id);
    [ids[2], ids[3]] = [ids[3], ids[2]];
    await reordenarReglas(base, s.reglas, ids);
    expect((await base.outbox.toArray()).map((c) => c.clave).sort()).toEqual([ids[2], ids[3]].sort());
  });
});

describe("sync: subida de lotes", () => {
  it("lote aceptado se borra de la cola; rechazado queda para revisar", async () => {
    const s = await instantanea();
    await registrarMovimiento(base, s, { cuenta_id: "c-caja-neg", tipo: "gasto", fecha: HOY, monto: 500_00, sobre_id: "s-nafta" });
    await registrarMovimiento(base, s, { cuenta_id: "c-billetera", tipo: "gasto", fecha: HOY, monto: 700_00, sobre_id: "s-super" });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "Separación de fondos" } });
    await subirPendientes(base, { rpc } as unknown as SupabaseClient);
    expect(rpc).toHaveBeenCalledTimes(2);
    const restantes = await base.outbox.toArray();
    expect(restantes).toHaveLength(1);
    expect(restantes[0]).toMatchObject({ error: "Separación de fondos", intentos: 1 });
  });

  it("sin señal no se pierde nada", async () => {
    const s = await instantanea();
    await registrarMovimiento(base, s, { cuenta_id: "c-caja-neg", tipo: "gasto", fecha: HOY, monto: 500_00, sobre_id: "s-nafta" });
    const rpc = vi.fn().mockResolvedValue({ error: { message: "TypeError: Failed to fetch" } });
    await expect(subirPendientes(base, { rpc } as unknown as SupabaseClient)).rejects.toBeTruthy();
    expect(await base.outbox.count()).toBe(1);
    expect((await base.outbox.toArray())[0].error).toBeNull();
  });
});
