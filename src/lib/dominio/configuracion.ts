/**
 * Configuración inicial guiada: a partir de pocas respuestas arma unidades,
 * cuentas, sobres, la cascada del sueldo y las deudas iniciales.
 * Pura: devuelve las filas; el repositorio las guarda en un lote.
 */
import type {
  Centavos, ConfigEmbudo, Cuenta, DeudaPropia, Moneda, ReglaEmbudo, Sobre, TipoCuenta, UnidadNegocio, Ambito, TipoSobre,
} from "./tipos";
import { ahoraISO, nuevoId } from "./utiles";

export interface CuentaInicial {
  nombre: string;
  ambito: Ambito;
  tipo: TipoCuenta;
  moneda: Moneda;
  /** Saldo de hoy. En tarjetas: lo que se debe hoy (se carga como deuda). */
  saldo: Centavos;
  compartida?: boolean;
  diaVencimiento?: number | null;
}

export interface RespuestasIniciales {
  negocios: { pensionado: boolean; alimento: boolean; cabanas: boolean; inauguracionCabanas?: string | null };
  cuentas: CuentaInicial[];
  /** Lo que la familia necesita por mes para vivir. */
  necesidadFamiliar: Centavos;
  /** Lo mínimo indispensable (va alto en la cascada). */
  sueldoMinimo: Centavos;
  reposicionAlimento: Centavos;
  cuotasYSeguros: Centavos;
  naftaYPeajes: Centavos;
  impuestos: Centavos;
}

export interface FilasIniciales {
  unidades: UnidadNegocio[];
  cuentas: Cuenta[];
  sobres: Sobre[];
  reglas: ReglaEmbudo[];
  deudas: DeudaPropia[];
  config: ConfigEmbudo;
}

export function armarConfiguracionInicial(hogarId: string, r: RespuestasIniciales): FilasIniciales {
  const m = ahoraISO();
  const base = { hogar_id: hogarId, creado_en: m, actualizado_en: m };

  const unidades: UnidadNegocio[] = [];
  const unidad = (nombre: string, tipo: UnidadNegocio["tipo"], color: string, fecha_inicio?: string | null) => {
    const u = { ...base, id: nuevoId(), nombre, tipo, activa: true, color, fecha_inicio: fecha_inicio ?? null };
    unidades.push(u);
    return u.id;
  };
  const uPension = r.negocios.pensionado ? unidad("Pensionado", "pensionado", "#0e7490") : null;
  const uAlimento = r.negocios.alimento ? unidad("Alimento", "alimento", "#b45309") : null;
  const uCabanas = r.negocios.cabanas ? unidad("Cabañas", "cabanas", "#15803d", r.negocios.inauguracionCabanas) : null;
  void uPension;

  const deudas: DeudaPropia[] = [];
  const cuentas: Cuenta[] = r.cuentas
    .filter((c) => c.nombre.trim())
    .map((c) => {
      const esTarjeta = c.tipo === "tarjeta_credito";
      const cuenta: Cuenta = {
        ...base, id: nuevoId(), nombre: c.nombre.trim(), ambito: c.ambito, tipo: c.tipo, moneda: c.moneda,
        // La deuda vieja de la tarjeta va a "Debemos"; la tarjeta arranca en 0 para que
        // las compras nuevas se aparten correctamente.
        saldo_inicial: esTarjeta ? 0 : c.saldo,
        compartida: esTarjeta && !!c.compartida, dia_vencimiento: esTarjeta ? c.diaVencimiento ?? null : null, archivada: false,
      };
      if (esTarjeta && c.saldo > 0) {
        deudas.push({
          ...base, id: nuevoId(), ambito: c.ambito, tipo: "tarjeta", acreedor: `Saldo anterior ${cuenta.nombre}`, moneda: c.moneda,
          monto_original: c.saldo, saldo_inicial: c.saldo, tasa_anual: 0, pago_minimo: 0, cuotas_pagadas_al_cargar: 0,
          dia_vencimiento: c.diaVencimiento ?? null, cancelada: false,
        });
      }
      return cuenta;
    });

  const sobres: Sobre[] = [];
  const sobre = (nombre: string, ambito: Ambito, tipo: TipoSobre, extra: Partial<Sobre> = {}) => {
    const s: Sobre = { ...base, id: nuevoId(), nombre, ambito, tipo, prioridad: 100, orden: sobres.length, ...extra };
    sobres.push(s);
    return s.id;
  };
  // Negocio
  const sAlimento = uAlimento ? sobre("Reponer alimento", "empresa", "costo_fijo", { unidad_negocio_id: uAlimento, grupo: "Caballos", meta_mensual: r.reposicionAlimento || null }) : null;
  const sNafta = sobre("Nafta y peajes", "empresa", "costo_fijo", { unidad_negocio_id: uAlimento, grupo: "Vehículos", meta_mensual: r.naftaYPeajes || null });
  const sCuotas = sobre("Cuotas y seguros", "empresa", "deuda", { grupo: "Vehículos", meta_mensual: r.cuotasYSeguros || null });
  if (uCabanas) sobre("Materiales cabañas", "empresa", "costo_fijo", { unidad_negocio_id: uCabanas, grupo: "Cabañas" });
  const sImpuestos = sobre("Impuestos", "empresa", "impuestos", { meta_mensual: r.impuestos || null });
  const sSueldo = sobre("Sueldo por transferir", "empresa", "sueldo");
  // Familia (prioridad: 1 = se llena primero)
  sobre("Bebé (pañales y leche)", "familia", "gasto_mensual", { grupo: "Hijos", prioridad: 1 });
  sobre("Colegio", "familia", "gasto_mensual", { grupo: "Hijos", prioridad: 5 });
  sobre("Luz, gas e internet", "familia", "costo_fijo", { grupo: "Casa", prioridad: 5 });
  sobre("Súper", "familia", "gasto_mensual", { grupo: "Casa", prioridad: 10 });
  sobre("Gastos personales", "familia", "gasto_mensual", { grupo: "Personal", prioridad: 30 });
  sobre("Fondo de emergencia", "familia", "fondo_emergencia", { grupo: "Metas", prioridad: 50, meta_monto: r.necesidadFamiliar * 3 || null });
  sobre("Ahorro", "familia", "ahorro", { grupo: "Metas", prioridad: 90 });

  // Cascada del sueldo (sueldo forzado con prioridades)
  const reglas: ReglaEmbudo[] = [];
  const regla = (nombre: string, destino: ReglaEmbudo["destino"], sobreId: string | null, tope: Centavos, extra: Partial<ReglaEmbudo> = {}) => {
    if (tope > 0) reglas.push({ ...base, id: nuevoId(), orden: reglas.length + 1, nombre, destino, sobre_id: sobreId, tope_mensual: tope, activa: true, ...extra });
  };
  if (sAlimento) regla("Reponer alimento", "sobre", sAlimento, r.reposicionAlimento, { porcentaje_max: 50 });
  regla("Sueldo mínimo", "sueldo", sSueldo, Math.min(r.sueldoMinimo, r.necesidadFamiliar || r.sueldoMinimo));
  regla("Cuotas y seguros", "sobre", sCuotas, r.cuotasYSeguros);
  regla("Nafta y peajes", "sobre", sNafta, r.naftaYPeajes);
  regla("Sueldo completo", "sueldo", sSueldo, Math.max(r.necesidadFamiliar - r.sueldoMinimo, 0));
  regla("Impuestos", "sobre", sImpuestos, r.impuestos);

  const cuentaFamilia = cuentas.find((c) => c.ambito === "familia" && c.tipo !== "tarjeta_credito" && c.moneda === "ARS");
  return {
    unidades, cuentas, sobres, reglas, deudas,
    config: { hogar_id: hogarId, modo: "forzar", sobre_sueldo_id: sSueldo, cuenta_familia_id: cuentaFamilia?.id ?? null, actualizado_en: m },
  };
}

export const CUENTAS_SUGERIDAS: CuentaInicial[] = [
  { nombre: "Banco Negocio", ambito: "empresa", tipo: "banco", moneda: "ARS", saldo: 0 },
  { nombre: "Caja Negocio (efectivo)", ambito: "empresa", tipo: "efectivo", moneda: "ARS", saldo: 0 },
  { nombre: "Dólares Negocio", ambito: "empresa", tipo: "efectivo", moneda: "USD", saldo: 0 },
  { nombre: "Billetera Familiar", ambito: "familia", tipo: "billetera_virtual", moneda: "ARS", saldo: 0 },
  { nombre: "Visa", ambito: "familia", tipo: "tarjeta_credito", moneda: "ARS", saldo: 0, compartida: true, diaVencimiento: 10 },
];
