/**
 * Datos de DEMOSTRACIÓN (modo sin Supabase). Ficticios, pero con la forma real
 * del caso: pensionado, alimento, cabañas por inaugurar, Visa compartida,
 * plan Hilux, cobros en dólares. Los ingresos se reparten con el Embudo REAL,
 * así los números son coherentes.
 */
import type { Instantanea } from "../dominio/calculos";
import { crearTransferenciaSueldo, planificarIngreso } from "../dominio/embudo";
import type {
  Cargo, Cuenta, Deudor, ReglaEmbudo, Sobre, Transaccion, UnidadNegocio, Asignacion, DeudaPropia,
} from "../dominio/tipos";
import { inicioDeMes, sumarDias } from "../dominio/utiles";

export const HOGAR_DEMO = "00000000-0000-4000-8000-000000000001";
const $ = (pesos: number) => Math.round(pesos * 100);

export function crearDemo(hoy: string): Instantanea {
  const H = HOGAR_DEMO;
  const marca = `${hoy}T08:00:00.000Z`;
  const base = { hogar_id: H, creado_en: marca, actualizado_en: marca };
  const mes = inicioDeMes(hoy);
  const mesAnterior = inicioDeMes(sumarDias(mes, -1));
  let n = 0;
  const id = (pref: string) => `${pref}-${String(++n).padStart(4, "0")}`;
  const diaDelMes = (d: number) => `${hoy.slice(0, 8)}${String(Math.min(d, Number(hoy.slice(8)))).padStart(2, "0")}`;

  // --- Unidades ----------------------------------------------------------
  const unidades: UnidadNegocio[] = [
    { ...base, id: "u-pension", nombre: "Pensionado", tipo: "pensionado", activa: true, color: "#0e7490" },
    { ...base, id: "u-alimento", nombre: "Alimento", tipo: "alimento", activa: true, color: "#b45309" },
    { ...base, id: "u-cabanas", nombre: "Cabañas", tipo: "cabanas", activa: true, fecha_inicio: sumarDias(hoy, 45), color: "#15803d" },
  ];

  // --- Cuentas -----------------------------------------------------------
  const cuenta = (c: Partial<Cuenta> & Pick<Cuenta, "id" | "nombre" | "ambito" | "tipo">): Cuenta => ({
    ...base, moneda: "ARS", saldo_inicial: 0, compartida: false, archivada: false, ...c,
  });
  const cuentas: Cuenta[] = [
    cuenta({ id: "c-banco-neg", nombre: "Banco Negocio", ambito: "empresa", tipo: "banco", saldo_inicial: $(380_000) }),
    cuenta({ id: "c-caja-neg", nombre: "Caja Negocio", ambito: "empresa", tipo: "efectivo", saldo_inicial: $(60_000) }),
    cuenta({ id: "c-usd", nombre: "Dólares Alimento", ambito: "empresa", tipo: "efectivo", moneda: "USD", unidad_negocio_id: "u-alimento", saldo_inicial: 0 }),
    cuenta({ id: "c-billetera", nombre: "Billetera Familiar", ambito: "familia", tipo: "billetera_virtual", saldo_inicial: $(35_000) }),
    cuenta({ id: "c-visa", nombre: "Visa", ambito: "familia", tipo: "tarjeta_credito", compartida: true, dia_cierre: 28, dia_vencimiento: 10 }),
  ];

  // --- Sobres ------------------------------------------------------------
  const sobre = (s: Partial<Sobre> & Pick<Sobre, "id" | "nombre" | "ambito" | "tipo">): Sobre => ({
    ...base, prioridad: 100, orden: 0, ...s,
  });
  const sobres: Sobre[] = [
    sobre({ id: "s-alimento", nombre: "Reponer alimento", ambito: "empresa", tipo: "costo_fijo", unidad_negocio_id: "u-alimento", grupo: "Caballos" }),
    sobre({ id: "s-nafta", nombre: "Nafta y peajes", ambito: "empresa", tipo: "costo_fijo", unidad_negocio_id: "u-alimento", grupo: "Vehículos" }),
    sobre({ id: "s-hilux", nombre: "Plan Hilux y seguros", ambito: "empresa", tipo: "deuda", unidad_negocio_id: "u-alimento", grupo: "Vehículos" }),
    sobre({ id: "s-impuestos", nombre: "Impuestos", ambito: "empresa", tipo: "impuestos" }),
    sobre({ id: "s-materiales", nombre: "Materiales cabañas", ambito: "empresa", tipo: "costo_fijo", unidad_negocio_id: "u-cabanas" }),
    sobre({ id: "s-sueldo", nombre: "Sueldo por transferir", ambito: "empresa", tipo: "sueldo" }),
    sobre({ id: "s-super", nombre: "Súper", ambito: "familia", tipo: "gasto_mensual", grupo: "Casa", prioridad: 10 }),
    sobre({ id: "s-bebe", nombre: "Bebé (pañales y leche)", ambito: "familia", tipo: "gasto_mensual", grupo: "Hijos", prioridad: 1 }),
    sobre({ id: "s-colegio", nombre: "Colegio", ambito: "familia", tipo: "gasto_mensual", grupo: "Hijos", prioridad: 5 }),
    sobre({ id: "s-servicios", nombre: "Luz, gas e internet", ambito: "familia", tipo: "costo_fijo", grupo: "Casa", prioridad: 5 }),
    sobre({ id: "s-emergencia", nombre: "Fondo de emergencia", ambito: "familia", tipo: "fondo_emergencia", meta_monto: $(1_800_000), prioridad: 50 }),
  ];

  // --- Reglas del Embudo (cascada) --------------------------------------
  const regla = (r: Partial<ReglaEmbudo> & Pick<ReglaEmbudo, "id" | "orden" | "nombre" | "destino" | "tope_mensual">): ReglaEmbudo => ({
    ...base, activa: true, ...r,
  });
  const reglas: ReglaEmbudo[] = [
    regla({ id: "r-alimento", orden: 1, nombre: "Reponer alimento", destino: "sobre", sobre_id: "s-alimento", tope_mensual: $(700_000), porcentaje_max: 50 }),
    regla({ id: "r-sueldo-min", orden: 2, nombre: "Sueldo mínimo", destino: "sueldo", sobre_id: "s-sueldo", tope_mensual: $(600_000) }),
    regla({ id: "r-hilux", orden: 3, nombre: "Plan Hilux y seguros", destino: "sobre", sobre_id: "s-hilux", tope_mensual: $(450_000) }),
    regla({ id: "r-nafta", orden: 4, nombre: "Nafta y peajes", destino: "sobre", sobre_id: "s-nafta", tope_mensual: $(150_000) }),
    regla({ id: "r-sueldo-full", orden: 5, nombre: "Sueldo completo", destino: "sueldo", sobre_id: "s-sueldo", tope_mensual: $(500_000) }),
    regla({ id: "r-impuestos", orden: 6, nombre: "Impuestos", destino: "sobre", sobre_id: "s-impuestos", tope_mensual: $(200_000) }),
  ];

  // --- Clientes y cargos del pensionado ---------------------------------
  const clientes: [string, number, number, string][] = [
    ["Haras La Esperanza", 4, 95_000, "5491100000001"],
    ["Martín R.", 2, 95_000, "5491100000002"],
    ["Juan P.", 1, 95_000, "5491100000003"],
    ["Carolina S.", 1, 95_000, "5491100000004"],
    ["Stud El Trébol", 3, 90_000, "5491100000005"],
  ];
  const deudores: Deudor[] = clientes.map(([nombre, caballos, tarifa, tel], i) => ({
    ...base, id: `d-${i + 1}`, unidad_negocio_id: "u-pension", nombre, telefono: tel,
    tarifa_mensual: $(tarifa), cantidad_unidades: caballos, dia_vencimiento: 10, dias_gracia: 5, activo: true,
  }));
  const cargos: Cargo[] = [];
  const cargo = (d: Deudor, periodo: string, vence: string, extra: Partial<Cargo> = {}): Cargo => {
    const c: Cargo = {
      ...base, id: id("cg"), unidad_negocio_id: "u-pension", deudor_id: d.id,
      concepto: `Pensión ${periodo.slice(0, 7)} · ${d.cantidad_unidades} caballo(s)`, periodo, moneda: "ARS",
      monto: (d.tarifa_mensual ?? 0) * (d.cantidad_unidades ?? 1), fecha_emision: periodo, fecha_vencimiento: vence,
      probabilidad_cobro: 100, estado: "pendiente", ...extra,
    };
    cargos.push(c);
    return c;
  };
  const dosMesesAtras = inicioDeMes(sumarDias(mesAnterior, -1));
  cargo(deudores[2], dosMesesAtras, sumarDias(dosMesesAtras, 9), { probabilidad_cobro: 50 }); // Juan: crítico
  cargo(deudores[2], mesAnterior, sumarDias(mesAnterior, 9), { probabilidad_cobro: 50 });
  cargo(deudores[1], mesAnterior, sumarDias(mesAnterior, 9));                                 // Martín: moroso
  for (const d of deudores) cargo(d, mes, sumarDias(mes, 9));                                // cuota del mes

  // --- Deudas -------------------------------------------------------------
  const deudas: DeudaPropia[] = [
    { ...base, id: "dp-hilux", ambito: "empresa", unidad_negocio_id: "u-alimento", tipo: "plan_ahorro", acreedor: "Plan Toyota Hilux",
      moneda: "ARS", monto_original: $(48_000_000), saldo_inicial: $(36_000_000), tasa_anual: 0, pago_minimo: $(400_000),
      cuotas_total: 120, cuotas_pagadas_al_cargar: 30, dia_vencimiento: 10, cuenta_tarjeta_id: "c-visa", sobre_id: "s-hilux", cancelada: false },
    { ...base, id: "dp-visa-vieja", ambito: "familia", tipo: "tarjeta", acreedor: "Saldo viejo Visa", moneda: "ARS",
      monto_original: $(1_000_000), saldo_inicial: $(900_000), tasa_anual: 120, pago_minimo: $(90_000), cuotas_pagadas_al_cargar: 0,
      dia_vencimiento: 10, cancelada: false },
  ];

  // --- Movimientos del mes -------------------------------------------------
  const s: Instantanea = {
    hogar: { id: H, nombre: "Familia (demo)", moneda_base: "ARS", estrategia_deuda: "avalancha", creado_en: marca, actualizado_en: marca },
    unidades, cuentas, sobres, asignaciones: [], transacciones: [], deudores, cargos, cobros: [],
    cotizaciones: [{ id: "q-demo", fecha: hoy, tipo: "blue", compra: 1400, venta: 1420, promedio: 1410, fuente: "automatica" }],
    deudas, reglas, distribuciones: [],
    config: { hogar_id: H, modo: "forzar", sobre_sueldo_id: "s-sueldo", cuenta_familia_id: "c-billetera", actualizado_en: marca },
  };

  const mov = (t: Partial<Transaccion> & Pick<Transaccion, "cuenta_id" | "ambito" | "tipo" | "monto" | "fecha">): Transaccion => {
    const tr: Transaccion = { ...base, id: id("t"), ...t };
    s.transacciones.push(tr);
    return tr;
  };
  /** Ingreso del negocio en pesos: pasa por el Embudo forzado. */
  const ingreso = (cuentaId: string, monto: number, fecha: string, unidad: string, desc: string, cargoPagado?: Cargo) => {
    const t = mov({ cuenta_id: cuentaId, ambito: "empresa", tipo: "ingreso", monto, fecha, unidad_negocio_id: unidad, descripcion: desc });
    const plan = planificarIngreso({ ingreso: t, reglas, distribuciones: s.distribuciones, config: s.config! });
    s.asignaciones.push(...plan.asignaciones);
    s.distribuciones.push(...plan.distribuciones);
    if (cargoPagado) {
      s.cobros.push({ ...base, id: id("co"), transaccion_id: t.id, cargo_id: cargoPagado.id, monto });
      cargoPagado.estado = monto >= cargoPagado.monto ? "pagado" : "parcial";
    }
  };
  const cuotaDelMes = (deudorIdx: number) => cargos.find((c) => c.deudor_id === deudores[deudorIdx].id && c.periodo === mes)!;

  ingreso("c-banco-neg", cuotaDelMes(0).monto, diaDelMes(3), "u-pension", "Pensión Haras La Esperanza", cuotaDelMes(0));
  ingreso("c-caja-neg", $(420_000), diaDelMes(5), "u-alimento", "Venta alimento hipódromo");
  ingreso("c-banco-neg", cuotaDelMes(4).monto, diaDelMes(8), "u-pension", "Pensión Stud El Trébol", cuotaDelMes(4));
  ingreso("c-caja-neg", $(310_000), diaDelMes(9), "u-alimento", "Venta alimento hipódromo");

  // Cobro en dólares: US$ 250 (no pasa por el embudo hasta convertirlos)
  mov({ cuenta_id: "c-usd", ambito: "empresa", tipo: "ingreso", monto: 25_000, fecha: diaDelMes(10), unidad_negocio_id: "u-alimento", descripcion: "Venta alimento (US$)" });

  // Gastos del negocio
  mov({ cuenta_id: "c-caja-neg", ambito: "empresa", tipo: "gasto", monto: -$(380_000), fecha: diaDelMes(6), sobre_id: "s-alimento", unidad_negocio_id: "u-alimento", descripcion: "Compra fardos y balanceado" });
  mov({ cuenta_id: "c-visa", ambito: "empresa", tipo: "gasto", monto: -$(62_000), fecha: diaDelMes(7), sobre_id: "s-nafta", unidad_negocio_id: "u-alimento", descripcion: "Nafta reparto" });

  // Sueldo ya pasado a la familia
  const disponibleSueldo = s.asignaciones.filter((a) => a.sobre_id === "s-sueldo").reduce((x, a) => x + a.monto, 0);
  const pasado = Math.min($(450_000), disponibleSueldo);
  if (pasado > 0) {
    const [sale, entra] = crearTransferenciaSueldo({
      hogarId: H, monto: pasado, fecha: diaDelMes(9),
      cuentaEmpresa: cuentas[0], cuentaFamilia: cuentas[3], sobreSueldoId: "s-sueldo",
      disponibleSobreSueldo: disponibleSueldo, saldoCuentaEmpresa: Number.MAX_SAFE_INTEGER,
    });
    s.transacciones.push(sale, entra);
  }

  // Presupuesto familiar: el sueldo recibido se reparte en sobres
  const asignar = (sobreId: string, pesos: number) =>
    s.asignaciones.push({ ...base, id: id("as"), sobre_id: sobreId, mes, monto: $(pesos) } satisfies Asignacion);
  asignar("s-bebe", 90_000);
  asignar("s-super", 180_000);
  asignar("s-colegio", 45_000);
  asignar("s-servicios", 70_000);
  asignar("s-emergencia", 60_000);

  mov({ cuenta_id: "c-billetera", ambito: "familia", tipo: "gasto", monto: -$(78_000), fecha: diaDelMes(9), sobre_id: "s-bebe", descripcion: "Pañales y leche" });
  mov({ cuenta_id: "c-visa", ambito: "familia", tipo: "gasto", monto: -$(126_000), fecha: diaDelMes(8), sobre_id: "s-super", descripcion: "Compra mayorista" });
  mov({ cuenta_id: "c-billetera", ambito: "familia", tipo: "gasto", monto: -$(52_000), fecha: diaDelMes(4), sobre_id: "s-servicios", descripcion: "Luz" });

  return s;
}
