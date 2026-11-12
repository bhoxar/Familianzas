/**
 * Reproduce el escenario de supabase/tests/reglas_negocio.sql y verifica que
 * los cálculos offline dan EXACTAMENTE lo mismo que las vistas SQL.
 */
import { describe, expect, it } from "vitest";
import type { Cuenta, Sobre, Transaccion } from "./tipos";
import {
  cuentasPorCobrar,
  flujoMes,
  plataSinDestino,
  resolverAmbito,
  saldoCuenta,
  tarjetasPorAmbito,
  ErrorSeparacion,
  type Instantanea,
} from "./calculos";
import { armarDashboard } from "./dashboard";
import { sumarDias } from "./utiles";

const HOY = "2026-11-11";
const MES = "2026-11-01";
const H = "h1";
const T = "2026-11-01T00:00:00Z";
const base = { hogar_id: H, creado_en: T, actualizado_en: T };

const cuenta = (id: string, ambito: "empresa" | "familia", nombre: string, extra: Partial<Cuenta> = {}): Cuenta => ({
  ...base, id, ambito, nombre, tipo: "banco", moneda: "ARS", saldo_inicial: 0, compartida: false, archivada: false, ...extra,
});
const sobre = (id: string, ambito: "empresa" | "familia", nombre: string, tipo: Sobre["tipo"], unidad: string | null = null): Sobre => ({
  ...base, id, ambito, nombre, tipo, unidad_negocio_id: unidad, prioridad: 100, orden: 0,
});
let n = 0;
const trx = (cuenta_id: string, ambito: "empresa" | "familia", tipo: Transaccion["tipo"], monto: number, extra: Partial<Transaccion> = {}): Transaccion => ({
  ...base, id: `t${++n}`, cuenta_id, ambito, tipo, monto, fecha: HOY, ...extra,
});

function escenario(): Instantanea {
  n = 0;
  const cuentas = [
    cuenta("c1", "empresa", "Banco Empresa"),
    cuenta("c2", "familia", "Billetera Familiar", { tipo: "billetera_virtual" }),
    cuenta("c3", "empresa", "Dólares Alimento", { tipo: "efectivo", moneda: "USD", unidad_negocio_id: "a2" }),
    cuenta("c4", "familia", "Visa", { tipo: "tarjeta_credito", compartida: true }),
  ];
  const sobres = [
    sobre("f1", "familia", "Súper", "gasto_mensual"),
    sobre("f2", "empresa", "Nafta y peajes", "costo_fijo", "a2"),
    sobre("f3", "empresa", "Sueldo por transferir", "sueldo"),
    sobre("f4", "empresa", "Plan Hilux", "deuda", "a2"),
  ];
  const transacciones: Transaccion[] = [
    trx("c1", "empresa", "ingreso", 50_000_000, { unidad_negocio_id: "a1" }),
    trx("c1", "empresa", "sueldo", -30_000_000, { grupo_id: "g2", sobre_id: "f3" }),
    trx("c2", "familia", "sueldo", 30_000_000, { grupo_id: "g2" }),
    { ...trx("c1", "empresa", "ingreso", 5_000_000, { unidad_negocio_id: "a1" }), id: "tab" },
    trx("c3", "empresa", "ingreso", 30_000, { unidad_negocio_id: "a2" }),
    trx("c3", "empresa", "transferencia", -20_000, { grupo_id: "g3", tipo_cambio: 1410, unidad_negocio_id: "a2" }),
    trx("c1", "empresa", "transferencia", 28_200_000, { grupo_id: "g3", tipo_cambio: 1410 }),
    trx("c4", "empresa", "gasto", -4_000_000, { sobre_id: "f2", unidad_negocio_id: "a2" }),
    trx("c4", "familia", "gasto", -2_500_000, { sobre_id: "f1" }),
    trx("c1", "empresa", "transferencia", -4_000_000, { grupo_id: "g4" }),
    trx("c4", "empresa", "transferencia", 4_000_000, { grupo_id: "g4" }),
    trx("c4", "empresa", "pago_deuda", -40_000_000, { sobre_id: "f4", deuda_id: "d1", unidad_negocio_id: "a2" }),
  ];
  return {
    hogar: { id: H, nombre: "Familia", moneda_base: "ARS", estrategia_deuda: "avalancha", creado_en: T, actualizado_en: T },
    unidades: [],
    cuentas,
    sobres,
    asignaciones: [
      { ...base, id: "a1", sobre_id: "f2", mes: MES, monto: 15_000_000 },
      { ...base, id: "a2", sobre_id: "f3", mes: MES, monto: 35_000_000 },
      { ...base, id: "a3", sobre_id: "f1", mes: MES, monto: 12_000_000 },
    ],
    transacciones,
    deudores: [{ ...base, id: "d1", unidad_negocio_id: "a1", nombre: "Juan", dias_gracia: 5, activo: true }],
    cargos: [{
      ...base, id: "b1", unidad_negocio_id: "a1", deudor_id: "d1", concepto: "Pensión", moneda: "ARS",
      monto: 8_000_000, fecha_emision: sumarDias(HOY, -40), fecha_vencimiento: sumarDias(HOY, -40),
      probabilidad_cobro: 100, estado: "parcial",
    }],
    cobros: [{ ...base, id: "ca1", transaccion_id: "tab", cargo_id: "b1", monto: 5_000_000 }],
    cotizaciones: [{ id: "q1", fecha: HOY, tipo: "blue", compra: 1400, venta: 1420, promedio: 1410, fuente: "automatica" }],
    deudas: [],
    reglas: [
      { ...base, id: "r1", orden: 1, nombre: "Nafta y peajes", destino: "sobre", sobre_id: "f2", tope_mensual: 15_000_000, activa: true },
      { ...base, id: "r2", orden: 2, nombre: "Sueldo mínimo", destino: "sueldo", sobre_id: "f3", tope_mensual: 60_000_000, activa: true },
    ],
    distribuciones: [
      { ...base, id: "e1", transaccion_ingreso_id: "t1", regla_id: "r1", mes: MES, monto: 15_000_000 },
      { ...base, id: "e2", transaccion_ingreso_id: "t1", regla_id: "r2", mes: MES, monto: 35_000_000 },
    ],
    config: { hogar_id: H, modo: "forzar", sobre_sueldo_id: "f3", cuenta_familia_id: "c2", actualizado_en: T },
  };
}

describe("cálculos offline = vistas SQL", () => {
  it("saldos de cuentas (v_saldo_cuentas)", () => {
    const s = escenario();
    const saldo = (id: string) => saldoCuenta(s.cuentas.find((c) => c.id === id)!, s.transacciones);
    expect(saldo("c1")).toBe(49_200_000);
    expect(saldo("c2")).toBe(30_000_000);
    expect(saldo("c3")).toBe(10_000); // US$ 100
    expect(saldo("c4")).toBe(-42_500_000);
  });

  it("tarjeta compartida dividida por ámbito (v_tarjetas_por_ambito)", () => {
    const t = tarjetasPorAmbito(escenario());
    expect(t.find((x) => x.ambito === "empresa")?.deuda).toBe(40_000_000);
    expect(t.find((x) => x.ambito === "familia")?.deuda).toBe(2_500_000);
  });

  it("plata sin destino: −$68.000 en el negocio por la cuota Hilux sin asignar", () => {
    const s = escenario();
    expect(plataSinDestino(s, "empresa", HOY)).toMatchObject({ monto: -6_800_000, dolares: 10_000 });
    expect(plataSinDestino(s, "familia", HOY).monto).toBe(18_000_000);
  });

  it("me deben con semáforo (v_cuentas_por_cobrar)", () => {
    const [p] = cuentasPorCobrar(escenario(), HOY);
    expect(p).toMatchObject({ saldo: 3_000_000, diasAtraso: 40, semaforo: "moroso" });
  });

  it("flujo del mes por unidad, dólares convertidos (v_flujo_mes)", () => {
    const s = escenario();
    expect(flujoMes(s, HOY, "a1")).toEqual({ esperado: 3_000_000, cobrado: 55_000_000, gastado: 0 });
    expect(flujoMes(s, HOY, "a2")).toEqual({ esperado: 0, cobrado: 42_300_000, gastado: 44_000_000 });
  });
});

describe("separación de fondos en el cliente (espejo del trigger)", () => {
  const s = escenario();
  const c = (id: string) => s.cuentas.find((x) => x.id === id)!;
  const so = (id: string) => s.sobres.find((x) => x.id === id)!;

  it("rechaza gasto del negocio en sobre familiar", () => {
    expect(() => resolverAmbito(c("c1"), so("f1"))).toThrow(ErrorSeparacion);
  });
  it("tarjeta compartida toma el ámbito del sobre", () => {
    expect(resolverAmbito(c("c4"), so("f2"))).toBe("empresa");
    expect(resolverAmbito(c("c4"), so("f1"))).toBe("familia");
  });
  it("tarjeta compartida sin sobre ni ámbito: error", () => {
    expect(() => resolverAmbito(c("c4"), null)).toThrow(/Negocio o de la Familia/);
  });
});

describe("Dashboard de doble perfil", () => {
  it("modo Negocio: alerta por plata negativa, sueldo y morosos", () => {
    const d = armarDashboard(escenario(), "empresa", HOY);
    if (d.ambito !== "empresa") throw new Error();
    expect(d.alerta?.titulo).toMatch(/Faltan/);
    expect(d.sueldo).toMatchObject({ objetivo: 60_000_000, asignado: 35_000_000, transferido: 30_000_000, paraTransferir: 5_000_000, deudaConFamilia: 30_000_000 });
    expect(d.meDeben.top[0]).toMatchObject({ nombre: "Juan", semaforo: "moroso" });
    expect(d.dolaresSinConvertir).toBe(10_000);
  });

  it("modo Familia: no ve nada del negocio", () => {
    const d = armarDashboard(escenario(), "familia", HOY);
    if (d.ambito !== "familia") throw new Error();
    expect(d.plataSinDestino).toBe(18_000_000);
    expect(d.sueldoRecibidoMes).toBe(30_000_000);
    expect(JSON.stringify(d)).not.toMatch(/Nafta|Hilux|Banco Empresa/);
  });
});
