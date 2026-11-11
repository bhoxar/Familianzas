/**
 * Arma lo que muestra el Dashboard de Doble Perfil a partir de la instantánea
 * local. Cada modo SOLO recibe datos de su ámbito: la UI no puede mezclar
 * fondos porque nunca los recibe juntos.
 */
import type { Ambito, Centavos, Fecha, Semaforo, Sobre } from "./tipos";
import {
  cotizacionVigente,
  cuentasPorCobrar,
  deudoresMorosos,
  flujoMes,
  plataSinDestino,
  saldosSobres,
  tarjetasPorAmbito,
  type FlujoMes,
  type Instantanea,
} from "./calculos";
import { estadoEmbudoMes, resumenSueldo, type EstadoRegla, type ResumenSueldo } from "./embudo";
import { diasEntre, finDeMes, inicioDeMes, pesos, sumar, vivos } from "./utiles";

export type NivelAlerta = "rojo" | "naranja";

export interface Alerta {
  nivel: NivelAlerta;
  titulo: string;
  detalle: string;
  accion?: { texto: string; href: string };
}

export interface ResumenMoroso {
  deudorId: string;
  nombre: string;
  telefono?: string | null;
  saldo: Centavos;
  diasAtraso: number;
  semaforo: Semaforo;
}

export interface DashboardNegocio {
  ambito: "empresa";
  alerta: Alerta | null;
  plataSinDestino: Centavos;
  dolaresSinConvertir: Centavos;
  cotizacion: { promedio: number; fecha: Fecha } | null;
  flujo: FlujoMes;
  sueldo: ResumenSueldo;
  embudo: EstadoRegla[];
  meDeben: { total: Centavos; clientes: number; top: ResumenMoroso[] };
}

export interface DashboardFamilia {
  ambito: "familia";
  alerta: Alerta | null;
  plataSinDestino: Centavos;
  sobresAtencion: { sobre: Sobre; disponible: Centavos; asignadoMes: Centavos }[];
  emergencia: { sobre: Sobre; disponible: Centavos; meta: Centavos } | null;
  sueldoRecibidoMes: Centavos;
  proximoPago: { nombre: string; monto: Centavos; fecha: Fecha } | null;
}

export type Dashboard = DashboardNegocio | DashboardFamilia;

/** Próxima fecha con ese día del mes, a partir de hoy. */
function proximaFechaDia(hoy: Fecha, dia: number): Fecha {
  const ultimo = Number(finDeMes(hoy).slice(8));
  const actual = `${hoy.slice(0, 8)}${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
  if (actual >= hoy) return actual;
  const [a, m] = hoy.split("-").map(Number);
  const sig = new Date(a, m, 1); // mes siguiente
  const ultSig = new Date(sig.getFullYear(), sig.getMonth() + 1, 0).getDate();
  return `${sig.getFullYear()}-${String(sig.getMonth() + 1).padStart(2, "0")}-${String(Math.min(dia, ultSig)).padStart(2, "0")}`;
}

function proximoPago(s: Instantanea, ambito: Ambito, hoy: Fecha) {
  const candidatos: { nombre: string; monto: Centavos; fecha: Fecha }[] = [];
  for (const t of tarjetasPorAmbito(s).filter((t) => t.ambito === ambito && t.deuda > 0)) {
    if (t.cuenta.dia_vencimiento) {
      const parte = t.cuenta.compartida ? (ambito === "empresa" ? " (parte negocio)" : " (parte familiar)") : "";
      candidatos.push({ nombre: `${t.cuenta.nombre}${parte}`, monto: t.deuda, fecha: proximaFechaDia(hoy, t.cuenta.dia_vencimiento) });
    }
  }
  for (const d of vivos(s.deudas).filter((d) => d.ambito === ambito && !d.cancelada && d.dia_vencimiento && !d.cuenta_tarjeta_id)) {
    candidatos.push({ nombre: d.acreedor, monto: d.pago_minimo, fecha: proximaFechaDia(hoy, d.dia_vencimiento!) });
  }
  return candidatos.sort((a, b) => (a.fecha < b.fecha ? -1 : 1))[0] ?? null;
}

/**
 * Alerta única (la más urgente), en este orden:
 *  1. Plata sin destino negativa.
 *  2. Pago en ≤ 3 días.
 *  3. (Negocio) cliente con más de 60 días.
 *  4. (Negocio) sueldo mínimo sin cubrir y quedan ≤ 7 días del mes.
 */
function alertaPrincipal(params: {
  ambito: Ambito;
  hoy: Fecha;
  plata: Centavos;
  pago: { nombre: string; monto: Centavos; fecha: Fecha } | null;
  peorMoroso?: ResumenMoroso;
  sueldo?: ResumenSueldo;
}): Alerta | null {
  const { ambito, hoy, plata, pago, peorMoroso, sueldo } = params;
  if (plata < 0) {
    return {
      nivel: "rojo",
      titulo: `Faltan ${pesos(-plata)}`,
      detalle: "Se gastó o se apartó más plata de la que hay. Sacá de algún sobre para cubrirlo.",
      accion: { texto: "Ver sobres", href: ambito === "empresa" ? "/negocio/sobres" : "/familia/sobres" },
    };
  }
  if (pago && diasEntre(hoy, pago.fecha) <= 3) {
    return {
      nivel: "naranja",
      titulo: `Vence ${pago.nombre}`,
      detalle: `${pesos(pago.monto)} el ${pago.fecha.slice(8)}/${pago.fecha.slice(5, 7)}`,
    };
  }
  if (peorMoroso && peorMoroso.semaforo === "critico") {
    return {
      nivel: "rojo",
      titulo: `${peorMoroso.nombre} debe hace ${peorMoroso.diasAtraso} días`,
      detalle: `${pesos(peorMoroso.saldo)} sin cobrar`,
      accion: { texto: "Ver Me deben", href: "/negocio/me-deben" },
    };
  }
  if (sueldo?.minimo && sueldo.minimo.cubierto < sueldo.minimo.tope && diasEntre(hoy, finDeMes(hoy)) <= 7) {
    return {
      nivel: "naranja",
      titulo: "El sueldo mínimo no está cubierto",
      detalle: `Faltan ${pesos(sueldo.minimo.tope - sueldo.minimo.cubierto)} y el mes termina pronto.`,
      accion: { texto: "Ver Sueldo", href: "/negocio/sueldo" },
    };
  }
  return null;
}

export function armarDashboard(s: Instantanea, ambito: Ambito, hoy: Fecha, unidadId?: string | null): Dashboard {
  const plata = plataSinDestino(s, ambito, hoy);
  const sobres = saldosSobres(s, hoy).filter((x) => x.sobre.ambito === ambito);
  const pago = proximoPago(s, ambito, hoy);

  if (ambito === "empresa") {
    const embudo = estadoEmbudoMes(s.reglas, s.distribuciones, hoy);
    const sobreSueldo = sobres.find((x) => x.sobre.id === s.config?.sobre_sueldo_id);
    const sueldo = resumenSueldo({
      estado: embudo,
      transacciones: s.transacciones,
      disponibleSobreSueldo: sobreSueldo?.disponible ?? 0,
      mes: hoy,
    });
    const pendientes = cuentasPorCobrar(s, hoy).filter(
      (p) => !unidadId || p.cargo.unidad_negocio_id === unidadId,
    );
    const morosos: ResumenMoroso[] = deudoresMorosos(pendientes)
      .filter((m) => m.semaforo !== "al_dia")
      .map((m) => ({
        deudorId: m.deudor.id,
        nombre: m.deudor.nombre,
        telefono: m.deudor.telefono,
        saldo: m.saldo,
        diasAtraso: m.diasAtraso,
        semaforo: m.semaforo,
      }));
    const cot = cotizacionVigente(s, hoy);
    return {
      ambito: "empresa",
      alerta: alertaPrincipal({ ambito, hoy, plata: plata.monto, pago, peorMoroso: morosos[0], sueldo }),
      plataSinDestino: plata.monto,
      dolaresSinConvertir: plata.dolares,
      cotizacion: cot ? { promedio: cot.promedio, fecha: cot.fecha } : null,
      flujo: flujoMes(s, hoy, unidadId),
      sueldo,
      embudo,
      meDeben: {
        total: sumar(pendientes.map((p) => p.saldo)),
        clientes: new Set(pendientes.map((p) => p.deudor.id)).size,
        top: morosos.slice(0, 3),
      },
    };
  }

  const mes = inicioDeMes(hoy);
  const emergencia = sobres.find((x) => x.sobre.tipo === "fondo_emergencia");
  const sobresAtencion = sobres
    .filter((x) => x.sobre.tipo === "gasto_mensual" || x.sobre.tipo === "costo_fijo")
    .filter((x) => x.disponible < 0 || (x.asignadoMes > 0 && x.disponible < x.asignadoMes * 0.2))
    .sort((a, b) => a.disponible - b.disponible)
    .slice(0, 3)
    .map((x) => ({ sobre: x.sobre, disponible: x.disponible, asignadoMes: x.asignadoMes }));

  return {
    ambito: "familia",
    alerta: alertaPrincipal({ ambito, hoy, plata: plata.monto, pago }),
    plataSinDestino: plata.monto,
    sobresAtencion,
    emergencia: emergencia
      ? { sobre: emergencia.sobre, disponible: emergencia.disponible, meta: emergencia.sobre.meta_monto ?? 0 }
      : null,
    sueldoRecibidoMes: sumar(
      vivos(s.transacciones)
        .filter((t) => t.tipo === "sueldo" && t.ambito === "familia" && t.monto > 0 && t.fecha >= mes)
        .map((t) => t.monto),
    ),
    proximoPago: pago,
  };
}
