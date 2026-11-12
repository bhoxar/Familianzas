import { describe, expect, it } from "vitest";
import { estadoDeudas, ordenarDeudas, simularSalida } from "./deudas";
import { proponerReparto } from "./presupuesto";
import { idDeterminista } from "./utiles";
import type { DeudaPropia, Sobre } from "./tipos";

const T = "2026-11-01T00:00:00Z";
const deuda = (id: string, saldo: number, tasa: number, minimo: number, extra: Partial<DeudaPropia> = {}): DeudaPropia => ({
  id, hogar_id: "h", creado_en: T, actualizado_en: T, ambito: "familia", tipo: "otro", acreedor: id, moneda: "ARS",
  monto_original: saldo, saldo_inicial: saldo, tasa_anual: tasa, pago_minimo: minimo, cuotas_pagadas_al_cargar: 0, cancelada: false, ...extra,
});

describe("deudas", () => {
  const deudas = [deuda("visa", 900_000_00, 120, 90_000_00), deuda("tio", 200_000_00, 0, 20_000_00), deuda("banco", 500_000_00, 60, 30_000_00)];
  const estados = estadoDeudas(deudas, []);

  it("avalancha ordena por tasa; bola de nieve por saldo", () => {
    expect(ordenarDeudas(estados, "avalancha").map((e) => e.deuda.id)).toEqual(["visa", "banco", "tio"]);
    expect(ordenarDeudas(estados, "bola_de_nieve").map((e) => e.deuda.id)).toEqual(["tio", "banco", "visa"]);
  });

  it("con más pago extra se sale antes y se pagan menos intereses", () => {
    const sin = simularSalida(estados, "avalancha", 0);
    const con = simularSalida(estados, "avalancha", 50_000_00);
    expect(con.meses).toBeLessThan(sin.meses);
    expect(con.interesesTotales).toBeLessThan(sin.interesesTotales);
    expect(con.sinSalida).toBe(false);
  });

  it("avalancha nunca paga más intereses que bola de nieve", () => {
    const a = simularSalida(estados, "avalancha", 50_000_00);
    const b = simularSalida(estados, "bola_de_nieve", 50_000_00);
    expect(a.interesesTotales).toBeLessThanOrEqual(b.interesesTotales);
  });

  it("detecta deudas sin salida (el mínimo no cubre el interés)", () => {
    const r = simularSalida(estadoDeudas([deuda("x", 1_000_000_00, 120, 5_000_00)], []), "avalancha", 0, 120);
    expect(r.sinSalida).toBe(true);
  });

  it("cuenta pagos y cuotas restantes", () => {
    const hilux = deuda("hilux", 36_000_000_00, 0, 400_000_00, { cuotas_total: 120, cuotas_pagadas_al_cargar: 30 });
    const [e] = estadoDeudas([hilux], [{ id: "t", hogar_id: "h", creado_en: T, actualizado_en: T, cuenta_id: "c", ambito: "empresa", tipo: "pago_deuda", fecha: "2026-11-10", monto: -400_000_00, deuda_id: "hilux" }]);
    expect(e).toMatchObject({ saldo: 35_600_000_00, cuotasRestantes: 89 });
  });
});

describe("reparto automático de sobres", () => {
  const sobre = (id: string, prioridad: number, meta_mensual: number, extra: Partial<Sobre> = {}): Sobre => ({
    id, hogar_id: "h", creado_en: T, actualizado_en: T, ambito: "familia", nombre: id, tipo: "gasto_mensual", prioridad, orden: 0, meta_mensual, ...extra,
  });
  it("llena por prioridad y nunca reparte más de lo que hay", () => {
    const p = proponerReparto([
      { sobre: sobre("super", 10, 180_000_00), asignadoMes: 0, actividadMes: 0, disponible: 0 },
      { sobre: sobre("bebe", 1, 90_000_00), asignadoMes: 30_000_00, actividadMes: 0, disponible: 30_000_00 },
      { sobre: sobre("negocio", 1, 999, { ambito: "empresa" }), asignadoMes: 0, actividadMes: 0, disponible: 0 },
    ], "familia", 100_000_00);
    expect(p.map((x) => [x.sobre.id, x.monto])).toEqual([["bebe", 60_000_00], ["super", 40_000_00]]);
  });
  it("primero cubre un sobre en rojo", () => {
    const p = proponerReparto([{ sobre: sobre("luz", 5, 0), asignadoMes: 0, actividadMes: -10_000_00, disponible: -10_000_00 }], "familia", 50_000_00);
    expect(p[0]).toMatchObject({ monto: 10_000_00, motivo: "Cubrir lo gastado de más" });
  });
  it("el fondo de emergencia no se pasa de su meta", () => {
    const p = proponerReparto([{ sobre: sobre("em", 50, 100_000_00, { tipo: "fondo_emergencia", meta_monto: 1_000_000_00 }), asignadoMes: 0, actividadMes: 0, disponible: 950_000_00 }], "familia", 500_000_00);
    expect(p[0].monto).toBe(50_000_00);
  });
});

describe("idDeterminista", () => {
  it("es estable, distinto por entrada y con forma de uuid", () => {
    const a = idDeterminista("cuota", "d1", "2026-11-01");
    expect(a).toBe(idDeterminista("cuota", "d1", "2026-11-01"));
    expect(a).not.toBe(idDeterminista("cuota", "d1", "2026-12-01"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
