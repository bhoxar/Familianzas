/**
 * EL EMBUDO — asignación FORZADA del sueldo familiar con cascada de prioridades.
 *
 * Cada peso que entra a la EMPRESA recorre las reglas en orden. Cada regla
 * tiene un tope mensual: se llena hasta su tope y lo que sobra cae a la
 * siguiente. Opcionalmente, una regla puede tomar como máximo un % de cada
 * ingreso (para que un solo cobro grande no se lo lleve todo).
 *
 * Las reglas de destino 'sueldo' llenan el sobre de empresa
 * "Sueldo por transferir": desde ese momento la plata está BLOQUEADA para el
 * negocio. Cuando la familia confirma que pasó la plata, se crea la
 * transferencia tipo 'sueldo' (empresa -> familia).
 *
 * Todo este módulo es puro (sin base de datos ni UI) para poder testearlo y
 * ejecutarlo igual con o sin señal.
 */
import type {
  Asignacion,
  Centavos,
  ConfigEmbudo,
  EmbudoDistribucion,
  Fecha,
  ReglaEmbudo,
  Transaccion,
} from "./tipos";
import { ahoraISO, inicioDeMes, nuevoId, sumar, vivos } from "./utiles";

export class ErrorEmbudo extends Error {}

// ---------------------------------------------------------------------------
// 1. Estado del mes: cuánto lleva cada regla
// ---------------------------------------------------------------------------
export interface EstadoRegla {
  regla: ReglaEmbudo;
  cubierto: Centavos;
  falta: Centavos;
}

export function reglasActivasOrdenadas(reglas: ReglaEmbudo[]): ReglaEmbudo[] {
  return vivos(reglas)
    .filter((r) => r.activa)
    .sort((a, b) => a.orden - b.orden);
}

export function estadoEmbudoMes(
  reglas: ReglaEmbudo[],
  distribuciones: EmbudoDistribucion[],
  mes: Fecha,
): EstadoRegla[] {
  const delMes = vivos(distribuciones).filter((d) => d.mes === inicioDeMes(mes));
  return reglasActivasOrdenadas(reglas).map((regla) => {
    const cubierto = sumar(delMes.filter((d) => d.regla_id === regla.id).map((d) => d.monto));
    return { regla, cubierto, falta: Math.max(regla.tope_mensual - cubierto, 0) };
  });
}

// ---------------------------------------------------------------------------
// 2. La cascada: cómo se reparte UN ingreso
// ---------------------------------------------------------------------------
export interface PasoReparto {
  regla: ReglaEmbudo;
  monto: Centavos;
}

export interface ResultadoReparto {
  pasos: PasoReparto[];
  /** Lo que no tomó ninguna regla: queda como "plata sin destino" del negocio. */
  sobrante: Centavos;
}

export function repartirIngreso(params: {
  monto: Centavos;
  /** Unidad de negocio del ingreso (para reglas específicas de una unidad). */
  unidadId?: string | null;
  estado: EstadoRegla[];
}): ResultadoReparto {
  const { monto, unidadId, estado } = params;
  if (!Number.isInteger(monto) || monto <= 0) {
    throw new ErrorEmbudo("El ingreso a repartir debe ser un monto positivo en centavos");
  }

  let restante = monto;
  const pasos: PasoReparto[] = [];

  for (const { regla, falta } of estado) {
    if (restante === 0) break;
    if (regla.unidad_negocio_id && regla.unidad_negocio_id !== unidadId) continue;
    if (falta <= 0) continue;

    const limitePorcentaje =
      regla.porcentaje_max != null
        ? Math.floor((monto * regla.porcentaje_max) / 100)
        : Number.POSITIVE_INFINITY;

    const toma = Math.min(restante, falta, limitePorcentaje);
    if (toma > 0) {
      pasos.push({ regla, monto: toma });
      restante -= toma;
    }
  }

  return { pasos, sobrante: restante };
}

// ---------------------------------------------------------------------------
// 3. Del reparto a filas de base de datos (asignaciones + distribuciones)
// ---------------------------------------------------------------------------
export interface PlanIngreso extends ResultadoReparto {
  asignaciones: Asignacion[];
  distribuciones: EmbudoDistribucion[];
}

/**
 * Arma las filas que hay que guardar para un ingreso de la empresa en PESOS.
 * (Los dólares no entran al embudo hasta convertirlos: la conversión
 * USD->ARS se reparte como un ingreso más.)
 */
export function planificarIngreso(params: {
  ingreso: Pick<Transaccion, "id" | "hogar_id" | "fecha" | "monto" | "unidad_negocio_id" | "ambito">;
  reglas: ReglaEmbudo[];
  distribuciones: EmbudoDistribucion[];
  config: Pick<ConfigEmbudo, "sobre_sueldo_id">;
  usuarioId?: string | null;
}): PlanIngreso {
  const { ingreso, reglas, distribuciones, config, usuarioId } = params;
  if (ingreso.ambito !== "empresa") {
    throw new ErrorEmbudo("Solo los ingresos del negocio pasan por el Embudo");
  }
  const yaRepartido = vivos(distribuciones).some((d) => d.transaccion_ingreso_id === ingreso.id);
  if (yaRepartido) {
    throw new ErrorEmbudo("Este ingreso ya fue repartido");
  }

  const mes = inicioDeMes(ingreso.fecha);
  const estado = estadoEmbudoMes(reglas, distribuciones, mes);
  const reparto = repartirIngreso({
    monto: ingreso.monto,
    unidadId: ingreso.unidad_negocio_id,
    estado,
  });

  const marca = ahoraISO();
  const asignaciones: Asignacion[] = [];
  const nuevasDistribuciones: EmbudoDistribucion[] = [];

  for (const paso of reparto.pasos) {
    const sobreId =
      paso.regla.destino === "sueldo"
        ? paso.regla.sobre_id ?? config.sobre_sueldo_id
        : paso.regla.sobre_id;
    if (!sobreId) {
      throw new ErrorEmbudo(
        paso.regla.destino === "sueldo"
          ? "Falta configurar el sobre 'Sueldo por transferir'"
          : `La regla "${paso.regla.nombre}" no tiene sobre`,
      );
    }

    const asignacion: Asignacion = {
      id: nuevoId(),
      hogar_id: ingreso.hogar_id,
      sobre_id: sobreId,
      mes,
      monto: paso.monto,
      nota: `Embudo: ${paso.regla.nombre}`,
      creado_por: usuarioId ?? null,
      creado_en: marca,
      actualizado_en: marca,
    };
    asignaciones.push(asignacion);
    nuevasDistribuciones.push({
      id: nuevoId(),
      hogar_id: ingreso.hogar_id,
      transaccion_ingreso_id: ingreso.id,
      regla_id: paso.regla.id,
      mes,
      monto: paso.monto,
      asignacion_id: asignacion.id,
      creado_en: marca,
      actualizado_en: marca,
    });
  }

  return { ...reparto, asignaciones, distribuciones: nuevasDistribuciones };
}

// ---------------------------------------------------------------------------
// 4. Resumen del sueldo del mes (lo que muestra la pantalla)
// ---------------------------------------------------------------------------
export interface ResumenSueldo {
  /** Suma de topes de todas las reglas de sueldo (mínimo + completo). */
  objetivo: Centavos;
  /** Cuánto del objetivo ya quedó bloqueado por el embudo este mes. */
  asignado: Centavos;
  /** Cuánto se pasó efectivamente a la familia este mes. */
  transferido: Centavos;
  /** Asignado y todavía no pasado: "Pasá $X a la familia". */
  paraTransferir: Centavos;
  /** "La empresa le debe a la familia $X" = objetivo − transferido. */
  deudaConFamilia: Centavos;
  /** Tope de la primera regla de sueldo (sueldo mínimo) y cuánto lleva. */
  minimo: { tope: Centavos; cubierto: Centavos } | null;
}

export function resumenSueldo(params: {
  estado: EstadoRegla[];
  transacciones: Transaccion[];
  /** Disponible actual del sobre "Sueldo por transferir". */
  disponibleSobreSueldo: Centavos;
  mes: Fecha;
}): ResumenSueldo {
  const { estado, transacciones, disponibleSobreSueldo, mes } = params;
  const deSueldo = estado.filter((e) => e.regla.destino === "sueldo");
  const objetivo = sumar(deSueldo.map((e) => e.regla.tope_mensual));
  const asignado = sumar(deSueldo.map((e) => e.cubierto));
  const ini = inicioDeMes(mes);
  const transferido = sumar(
    vivos(transacciones)
      .filter(
        (t) =>
          t.tipo === "sueldo" &&
          t.ambito === "familia" &&
          t.monto > 0 &&
          inicioDeMes(t.fecha) === ini,
      )
      .map((t) => t.monto),
  );
  const primero = deSueldo[0];
  return {
    objetivo,
    asignado,
    transferido,
    paraTransferir: Math.max(disponibleSobreSueldo, 0),
    deudaConFamilia: Math.max(objetivo - transferido, 0),
    minimo: primero ? { tope: primero.regla.tope_mensual, cubierto: primero.cubierto } : null,
  };
}

// ---------------------------------------------------------------------------
// 5. Confirmar el pase real de plata a la familia
// ---------------------------------------------------------------------------
/**
 * Crea las DOS patas de la transferencia de sueldo. Deben guardarse y
 * enviarse juntas: la base de datos verifica que sumen cero y que vayan de
 * EMPRESA a FAMILIA.
 */
export function crearTransferenciaSueldo(params: {
  hogarId: string;
  monto: Centavos;
  fecha: Fecha;
  cuentaEmpresa: { id: string; ambito: string; moneda: string };
  cuentaFamilia: { id: string; ambito: string; moneda: string };
  sobreSueldoId: string;
  disponibleSobreSueldo: Centavos;
  saldoCuentaEmpresa: Centavos;
  usuarioId?: string | null;
  dispositivoId?: string | null;
}): [Transaccion, Transaccion] {
  const p = params;
  if (!Number.isInteger(p.monto) || p.monto <= 0) throw new ErrorEmbudo("Monto inválido");
  if (p.cuentaEmpresa.ambito !== "empresa") throw new ErrorEmbudo("El sueldo sale de una cuenta del negocio");
  if (p.cuentaFamilia.ambito !== "familia") throw new ErrorEmbudo("El sueldo entra a una cuenta de la familia");
  if (p.cuentaEmpresa.moneda !== p.cuentaFamilia.moneda) {
    throw new ErrorEmbudo("Las dos cuentas deben ser de la misma moneda");
  }
  if (p.monto > p.disponibleSobreSueldo) {
    throw new ErrorEmbudo("No hay tanto sueldo asignado: el Embudo todavía no lo cubrió");
  }
  if (p.monto > p.saldoCuentaEmpresa) {
    throw new ErrorEmbudo("La cuenta del negocio no tiene ese saldo");
  }

  const grupo = nuevoId();
  const marca = ahoraISO();
  const base = {
    hogar_id: p.hogarId,
    tipo: "sueldo" as const,
    fecha: p.fecha,
    grupo_id: grupo,
    descripcion: "Sueldo familiar",
    creado_por: p.usuarioId ?? null,
    dispositivo_id: p.dispositivoId ?? null,
    creado_en: marca,
    actualizado_en: marca,
  };
  return [
    { ...base, id: nuevoId(), cuenta_id: p.cuentaEmpresa.id, ambito: "empresa", monto: -p.monto, sobre_id: p.sobreSueldoId },
    { ...base, id: nuevoId(), cuenta_id: p.cuentaFamilia.id, ambito: "familia", monto: p.monto, sobre_id: null },
  ];
}
