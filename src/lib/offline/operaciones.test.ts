import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { FamilianzasDB } from "./db";
import { leerInstantanea } from "./repositorio";
import {
  asignarASobre, aplicarReparto, convertirDolares, generarCuotasMes, moverEntreSobres, pagarDeuda, pagarTarjeta,
  propuestaRepartoAuto, registrarCobroCliente, guardarCotizacion, cambiarEstrategia,
} from "./operaciones";
import { cargarDemo } from "../demo/cargar";
import { HOGAR_DEMO } from "../demo/datos-demo";
import { cuentasPorCobrar, plataSinDestino, saldosSobres, tarjetasPorAmbito } from "../dominio/calculos";
import { estadoDeudas } from "../dominio/deudas";

const HOY = "2026-11-11";
let base: FamilianzasDB;
const s = async () => (await leerInstantanea(base, HOGAR_DEMO))!;
beforeEach(async () => {
  base = new FamilianzasDB(`op-${crypto.randomUUID()}`);
  await cargarDemo(base, HOY);
});

describe("Me deben", () => {
  it("el cobro se aplica a la deuda más vieja primero y pasa por el Embudo", async () => {
    const antes = cuentasPorCobrar(await s(), HOY).filter((p) => p.deudor.nombre === "Juan P.");
    const r = await registrarCobroCliente(base, await s(), { deudorId: "d-3", monto: 100_000_00, cuentaId: "c-banco-neg", fecha: HOY });
    expect(r.aplicados[0].cargo_id).toBe(antes[0].cargo.id); // el más viejo (mayor atraso)
    expect(r.aplicados.reduce((a, x) => a + x.monto, 0)).toBe(100_000_00);
    expect(r.embudo).not.toBeNull();
    const despues = cuentasPorCobrar(await s(), HOY).filter((p) => p.deudor.nombre === "Juan P.");
    expect(despues.reduce((a, p) => a + p.saldo, 0)).toBe(antes.reduce((a, p) => a + p.saldo, 0) - 100_000_00);
  });

  it("lo cobrado de más queda a favor", async () => {
    const r = await registrarCobroCliente(base, await s(), { deudorId: "d-4", monto: 120_000_00, cuentaId: "c-banco-neg", fecha: HOY });
    expect(r.aFavor).toBe(25_000_00);
  });

  it("generar cuotas del mes es idempotente (mismo id en cualquier teléfono)", async () => {
    const primeras = await generarCuotasMes(base, await s(), "2026-12-05");
    expect(primeras).toHaveLength(5);
    expect(await generarCuotasMes(base, await s(), "2026-12-20")).toHaveLength(0);
  });
});

describe("Sobres", () => {
  it("no deja asignar plata que no existe", async () => {
    const libre = plataSinDestino(await s(), "familia", HOY).monto;
    await expect(asignarASobre(base, await s(), "s-super", libre + 1, HOY)).rejects.toThrow(/sin destino/);
    await asignarASobre(base, await s(), "s-super", libre, HOY);
    expect(plataSinDestino(await s(), "familia", HOY).monto).toBe(0);
  });

  it("mover entre sobres no cambia la plata sin destino y no cruza ámbitos", async () => {
    const libre = plataSinDestino(await s(), "familia", HOY).monto;
    await moverEntreSobres(base, await s(), "s-emergencia", "s-bebe", 10_000_00, HOY);
    expect(plataSinDestino(await s(), "familia", HOY).monto).toBe(libre);
    await expect(moverEntreSobres(base, await s(), "s-nafta", "s-super", 100, HOY)).rejects.toThrow(/ámbitos/);
  });

  it("reparto automático usa solo lo disponible", async () => {
    const sx = await s();
    sx.sobres = sx.sobres.map((o) => (o.id === "s-super" ? { ...o, meta_mensual: 400_000_00 } : o));
    const prop = propuestaRepartoAuto(sx, "familia", HOY);
    await aplicarReparto(base, sx, prop, HOY);
    expect(plataSinDestino(await s(), "familia", HOY).monto).toBeGreaterThanOrEqual(0);
  });
});

describe("Deudas y tarjetas", () => {
  it("pagar la cuota Hilux con la Visa la imputa al Negocio", async () => {
    await pagarDeuda(base, await s(), { deudaId: "dp-hilux", cuentaId: "c-visa", monto: 400_000_00, fecha: HOY });
    const sx = await s();
    expect(estadoDeudas(sx.deudas, sx.transacciones).find((e) => e.deuda.id === "dp-hilux")?.cuotasRestantes).toBe(89);
    expect(tarjetasPorAmbito(sx).find((t) => t.ambito === "empresa")?.deuda).toBe(462_000_00);
  });

  it("la familia no puede pagar una deuda del negocio", async () => {
    await expect(pagarDeuda(base, await s(), { deudaId: "dp-hilux", cuentaId: "c-billetera", monto: 100, fecha: HOY })).rejects.toThrow(/mezclan/);
  });

  it("cada ámbito paga su parte de la tarjeta", async () => {
    await expect(pagarTarjeta(base, await s(), { tarjetaId: "c-visa", ambito: "empresa", cuentaId: "c-billetera", monto: 100 })).rejects.toThrow(/Cada parte/);
    await pagarTarjeta(base, await s(), { tarjetaId: "c-visa", ambito: "familia", cuentaId: "c-billetera", monto: 126_000_00 });
    expect(tarjetasPorAmbito(await s()).find((t) => t.ambito === "familia")?.deuda).toBe(0);
  });

  it("cambiar estrategia se guarda en el hogar", async () => {
    await cambiarEstrategia(base, await s(), "bola_de_nieve");
    expect((await s()).hogar.estrategia_deuda).toBe("bola_de_nieve");
  });
});

describe("Dólares", () => {
  it("vender US$ 100 al promedio entra en pesos y se reparte con el Embudo", async () => {
    const r = await convertirDolares(base, await s(), { cuentaUsdId: "c-usd", cuentaPesosId: "c-banco-neg", usd: 100_00, cotizacion: 1410 });
    expect(r.pesosRecibidos).toBe(141_000_00);
    expect(r.embudo?.pasos.length).toBeGreaterThan(0);
    expect(plataSinDestino(await s(), "empresa", HOY).dolares).toBe(150_00);
  });

  it("una cotización por día (la segunda la reemplaza)", async () => {
    await guardarCotizacion(base, await s(), { compra: 1400, venta: 1420, fecha: HOY, fuente: "automatica" });
    await guardarCotizacion(base, await s(), { compra: 1450, venta: 1470, fecha: HOY, fuente: "manual" });
    const propias = (await s()).cotizaciones.filter((c) => c.hogar_id === HOGAR_DEMO);
    expect(propias).toHaveLength(1);
    expect(propias[0].promedio).toBe(1460);
  });
});

it("sobres: saldo de demo coherente", async () => {
  expect(saldosSobres(await s(), HOY).find((x) => x.sobre.id === "s-bebe")?.disponible).toBe(12_000_00);
});
