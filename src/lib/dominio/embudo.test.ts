import { describe, expect, it } from "vitest";
import {
  crearTransferenciaSueldo,
  ErrorEmbudo,
  estadoEmbudoMes,
  planificarIngreso,
  repartirIngreso,
  resumenSueldo,
} from "./embudo";
import type { EmbudoDistribucion, ReglaEmbudo } from "./tipos";

const T = "2026-11-01T00:00:00Z";
const base = { hogar_id: "h1", creado_en: T, actualizado_en: T };
const regla = (id: string, orden: number, destino: "sobre" | "sueldo", tope: number, extra: Partial<ReglaEmbudo> = {}): ReglaEmbudo => ({
  ...base, id, orden, nombre: id, destino, sobre_id: destino === "sueldo" ? "sobre-sueldo" : `sobre-${id}`,
  tope_mensual: tope, activa: true, ...extra,
});

// Cascada del documento de Fase 2 (en pesos -> centavos con * 100)
const REGLAS = [
  regla("alimento", 1, "sobre", 900_000_00),
  regla("sueldo_min", 2, "sueldo", 600_000_00),
  regla("hilux", 3, "sobre", 400_000_00),
  regla("sueldo_full", 4, "sueldo", 500_000_00),
  regla("impuestos", 5, "sobre", 200_000_00),
];

describe("repartirIngreso: la cascada", () => {
  it("un cobro chico solo llena la primera regla", () => {
    const r = repartirIngreso({ monto: 500_000_00, estado: estadoEmbudoMes(REGLAS, [], "2026-11-15") });
    expect(r.pasos.map((p) => [p.regla.id, p.monto])).toEqual([["alimento", 500_000_00]]);
    expect(r.sobrante).toBe(0);
  });

  it("el segundo cobro completa lo que faltaba y sigue con el sueldo mínimo", () => {
    const previas: EmbudoDistribucion[] = [
      { ...base, id: "d1", transaccion_ingreso_id: "t1", regla_id: "alimento", mes: "2026-11-01", monto: 500_000_00 },
    ];
    const r = repartirIngreso({ monto: 800_000_00, estado: estadoEmbudoMes(REGLAS, previas, "2026-11-20") });
    expect(r.pasos.map((p) => [p.regla.id, p.monto])).toEqual([
      ["alimento", 400_000_00],
      ["sueldo_min", 400_000_00],
    ]);
  });

  it("con todo lleno, el sobrante queda como plata sin destino", () => {
    const llenas = REGLAS.map((r, i) => ({
      ...base, id: `d${i}`, transaccion_ingreso_id: "t0", regla_id: r.id, mes: "2026-11-01", monto: r.tope_mensual,
    }));
    const r = repartirIngreso({ monto: 100_000_00, estado: estadoEmbudoMes(REGLAS, llenas, "2026-11-28") });
    expect(r).toEqual({ pasos: [], sobrante: 100_000_00 });
  });

  it("las distribuciones de otro mes no cuentan (el tope es mensual)", () => {
    const octubre = [{ ...base, id: "x", transaccion_ingreso_id: "t0", regla_id: "alimento", mes: "2026-10-01", monto: 900_000_00 }];
    const est = estadoEmbudoMes(REGLAS, octubre, "2026-11-02");
    expect(est[0].falta).toBe(900_000_00);
  });

  it("porcentaje_max evita que una regla se lleve todo un cobro grande", () => {
    const reglas = [regla("stock", 1, "sobre", 2_000_000_00, { porcentaje_max: 40 }), regla("sueldo", 2, "sueldo", 600_000_00)];
    const r = repartirIngreso({ monto: 1_000_000_00, estado: estadoEmbudoMes(reglas, [], "2026-11-05") });
    expect(r.pasos.map((p) => [p.regla.id, p.monto])).toEqual([
      ["stock", 400_000_00],
      ["sueldo", 600_000_00],
    ]);
  });

  it("reglas de una unidad solo toman ingresos de esa unidad", () => {
    const reglas = [regla("forraje", 1, "sobre", 300_000_00, { unidad_negocio_id: "alimento" }), regla("sueldo", 2, "sueldo", 600_000_00)];
    const deCabanas = repartirIngreso({ monto: 200_000_00, unidadId: "cabanas", estado: estadoEmbudoMes(reglas, [], "2026-11-05") });
    expect(deCabanas.pasos.map((p) => p.regla.id)).toEqual(["sueldo"]);
  });

  it("ignora reglas inactivas o borradas y respeta el orden aunque vengan desordenadas", () => {
    const reglas = [regla("b", 2, "sueldo", 100), regla("a", 1, "sobre", 100), regla("off", 0, "sobre", 100, { activa: false })];
    const r = repartirIngreso({ monto: 150, estado: estadoEmbudoMes(reglas, [], "2026-11-05") });
    expect(r.pasos.map((p) => [p.regla.id, p.monto])).toEqual([["a", 100], ["b", 50]]);
  });

  it("rechaza montos no válidos", () => {
    expect(() => repartirIngreso({ monto: 0, estado: [] })).toThrow(ErrorEmbudo);
    expect(() => repartirIngreso({ monto: 10.5, estado: [] })).toThrow(ErrorEmbudo);
  });
});

describe("planificarIngreso: filas a guardar", () => {
  const ingreso = { id: "t1", hogar_id: "h1", fecha: "2026-11-11", monto: 1_200_000_00, unidad_negocio_id: null, ambito: "empresa" as const };

  it("genera una asignación y una distribución por paso, enlazadas", () => {
    const plan = planificarIngreso({ ingreso, reglas: REGLAS, distribuciones: [], config: { sobre_sueldo_id: "sobre-sueldo" } });
    expect(plan.asignaciones.map((a) => [a.sobre_id, a.monto, a.mes])).toEqual([
      ["sobre-alimento", 900_000_00, "2026-11-01"],
      ["sobre-sueldo", 300_000_00, "2026-11-01"],
    ]);
    expect(plan.distribuciones.map((d) => d.asignacion_id)).toEqual(plan.asignaciones.map((a) => a.id));
  });

  it("no reparte dos veces el mismo ingreso", () => {
    const plan = planificarIngreso({ ingreso, reglas: REGLAS, distribuciones: [], config: { sobre_sueldo_id: "s" } });
    expect(() =>
      planificarIngreso({ ingreso, reglas: REGLAS, distribuciones: plan.distribuciones, config: { sobre_sueldo_id: "s" } }),
    ).toThrow(/ya fue repartido/);
  });

  it("los ingresos de la familia no pasan por el embudo", () => {
    expect(() =>
      planificarIngreso({ ingreso: { ...ingreso, ambito: "familia" }, reglas: REGLAS, distribuciones: [], config: { sobre_sueldo_id: "s" } }),
    ).toThrow(ErrorEmbudo);
  });
});

describe("sueldo: resumen y transferencia", () => {
  it("calcula lo que la empresa le debe a la familia", () => {
    const dist = [{ ...base, id: "d", transaccion_ingreso_id: "t", regla_id: "sueldo_min", mes: "2026-11-01", monto: 350_000_00 }];
    const r = resumenSueldo({
      estado: estadoEmbudoMes(REGLAS, dist, "2026-11-11"),
      transacciones: [{ ...base, id: "x", cuenta_id: "fam", ambito: "familia", tipo: "sueldo", monto: 300_000_00, fecha: "2026-11-05", grupo_id: "g" }],
      disponibleSobreSueldo: 50_000_00,
      mes: "2026-11-11",
    });
    expect(r).toEqual({
      objetivo: 1_100_000_00,
      asignado: 350_000_00,
      transferido: 300_000_00,
      paraTransferir: 50_000_00,
      deudaConFamilia: 800_000_00,
      minimo: { tope: 600_000_00, cubierto: 350_000_00 },
    });
  });

  const params = {
    hogarId: "h1", monto: 50_000_00, fecha: "2026-11-11",
    cuentaEmpresa: { id: "emp", ambito: "empresa", moneda: "ARS" },
    cuentaFamilia: { id: "fam", ambito: "familia", moneda: "ARS" },
    sobreSueldoId: "sobre-sueldo", disponibleSobreSueldo: 50_000_00, saldoCuentaEmpresa: 900_000_00,
  };

  it("crea dos patas que suman cero, de empresa a familia", () => {
    const [sale, entra] = crearTransferenciaSueldo(params);
    expect(sale).toMatchObject({ cuenta_id: "emp", ambito: "empresa", monto: -50_000_00, tipo: "sueldo", sobre_id: "sobre-sueldo" });
    expect(entra).toMatchObject({ cuenta_id: "fam", ambito: "familia", monto: 50_000_00, tipo: "sueldo" });
    expect(sale.grupo_id).toBe(entra.grupo_id);
  });

  it("no deja pasar más sueldo del que el embudo ya cubrió", () => {
    expect(() => crearTransferenciaSueldo({ ...params, monto: 60_000_00 })).toThrow(/todavía no lo cubrió/);
  });

  it("no deja invertir el sentido", () => {
    expect(() =>
      crearTransferenciaSueldo({ ...params, cuentaEmpresa: params.cuentaFamilia, cuentaFamilia: params.cuentaEmpresa }),
    ).toThrow(ErrorEmbudo);
  });
});
