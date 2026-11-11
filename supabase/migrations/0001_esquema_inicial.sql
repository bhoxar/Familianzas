-- =============================================================================
-- Familianzas · Migración 0001 · Esquema inicial
-- Economía híbrida familia + negocios (pensionado equino, alimento, cabañas)
--
-- Convenciones:
--   * Montos en CENTAVOS (bigint). Nunca float para dinero.
--   * PK uuid generadas en el CLIENTE (offline-first: el id existe antes de sincronizar).
--   * Toda tabla sincronizable tiene: hogar_id, creado_en, actualizado_en, eliminado_en
--     (borrado lógico para que los dispositivos offline se enteren de las bajas).
--   * "ambito" separa estrictamente EMPRESA de FAMILIA. El dinero solo cruza de
--     ámbito a través de una transferencia tipo 'sueldo' o 'aporte_capital'.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
create type ambito            as enum ('empresa', 'familia');
create type rol_hogar         as enum ('admin', 'miembro', 'lector');
create type tipo_unidad       as enum ('pensionado', 'alimento', 'cabanas', 'otro');
create type tipo_cuenta       as enum ('efectivo', 'banco', 'billetera_virtual', 'tarjeta_credito');
create type moneda            as enum ('ARS', 'USD');
create type tipo_transaccion  as enum (
  'ingreso',          -- venta / cobro sin cargo previo
  'gasto',
  'transferencia',    -- entre cuentas del MISMO ámbito
  'sueldo',           -- EMPRESA -> FAMILIA (salida del Embudo)
  'aporte_capital',   -- FAMILIA -> EMPRESA (préstamo/aporte explícito)
  'pago_deuda',
  'ajuste'            -- conciliación de saldo
);
create type estado_cargo      as enum ('pendiente', 'parcial', 'pagado', 'incobrable', 'anulado');
create type tipo_sobre        as enum (
  'gasto_mensual', 'costo_fijo', 'fondo_emergencia', 'ahorro', 'inversion', 'impuestos', 'deuda',
  'sueldo'            -- sobre de EMPRESA "Sueldo por transferir" que llena el Embudo
);
create type estrategia_deuda  as enum ('avalancha', 'bola_de_nieve');
create type tipo_deuda        as enum ('prestamo', 'tarjeta', 'compra_en_cuotas', 'plan_ahorro', 'proveedor', 'otro');
create type destino_regla     as enum ('sobre', 'sueldo');

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------
create or replace function tocar_actualizado_en() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Hogares y Usuarios (multi-tenant: un hogar = una familia)
-- -----------------------------------------------------------------------------
create table hogares (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  moneda_base        moneda not null default 'ARS',
  estrategia_deuda   estrategia_deuda not null default 'avalancha',
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);

-- Perfil de usuario 1:1 con auth.users de Supabase
create table usuarios (
  id                 uuid primary key references auth.users(id) on delete cascade,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  nombre             text not null,
  rol                rol_hogar not null default 'miembro',
  modo_preferido     ambito not null default 'familia',  -- recuerda el toggle
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
create index on usuarios (hogar_id);

-- Hogar del usuario autenticado (usado por todas las políticas RLS)
create or replace function mi_hogar() returns uuid
language sql stable security definer set search_path = public as $$
  select hogar_id from usuarios where id = auth.uid()
$$;

-- -----------------------------------------------------------------------------
-- 2. Unidades de negocio
-- -----------------------------------------------------------------------------
create table unidades_negocio (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  nombre             text not null,
  tipo               tipo_unidad not null,
  activa             boolean not null default true,
  fecha_inicio       date,                         -- cabañas: fecha de inauguración
  color              text,                         -- para la UI
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz
);
create index on unidades_negocio (hogar_id);

-- -----------------------------------------------------------------------------
-- 3. Cuentas (billeteras). Cada cuenta pertenece a UN ámbito. Es la base de la
--    separación estricta.
--    Única excepción: TARJETA DE CRÉDITO COMPARTIDA (compartida = true). En la
--    realidad una misma Visa paga nafta del reparto y el súper de la casa. La
--    cuenta guarda el ámbito del titular, pero CADA movimiento toma el ámbito de
--    su sobre, y el resumen se paga por partes: la empresa paga lo suyo y la
--    familia lo suyo (ver v_tarjetas_por_ambito).
-- -----------------------------------------------------------------------------
create table cuentas (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  ambito             ambito not null,
  unidad_negocio_id  uuid references unidades_negocio(id),  -- null = caja común de la empresa / familia
  nombre             text not null,
  tipo               tipo_cuenta not null,
  moneda             moneda not null default 'ARS',
  saldo_inicial      bigint not null default 0,
  compartida         boolean not null default false,
  dia_cierre         smallint check (dia_cierre between 1 and 31),       -- tarjetas
  dia_vencimiento    smallint check (dia_vencimiento between 1 and 31),  -- tarjetas
  archivada          boolean not null default false,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz,
  constraint cuenta_familia_sin_unidad check (ambito = 'empresa' or unidad_negocio_id is null),
  constraint solo_tarjetas_compartidas check (not compartida or tipo = 'tarjeta_credito')
);
create index on cuentas (hogar_id, ambito);

-- -----------------------------------------------------------------------------
-- 3b. Cotizaciones del dólar
--     Fuente por defecto: dólar blue, valor PROMEDIO = (compra + venta) / 2, el
--     mismo criterio que usan con dolarhoy.com. Se guarda una por día (la carga
--     una Edge Function); el usuario puede pisarla a mano para su hogar
--     (hogar_id no nulo) si cambió a otro valor. Offline se usa la última guardada.
-- -----------------------------------------------------------------------------
create table cotizaciones (
  id                 uuid primary key default gen_random_uuid(),
  hogar_id           uuid references hogares(id) on delete cascade,  -- null = cotización general
  fecha              date not null,
  tipo               text not null default 'blue',
  compra             numeric(14,4) not null check (compra > 0),
  venta              numeric(14,4) not null check (venta > 0),
  promedio           numeric(14,4) generated always as (round((compra + venta) / 2, 4)) stored,
  fuente             text not null default 'automatica',   -- 'automatica' | 'manual'
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint cotizacion_unica unique nulls not distinct (hogar_id, fecha, tipo)
);

-- -----------------------------------------------------------------------------
-- 4. Sobres (Presupuesto Base Cero estilo YNAB + metas + fondo de emergencia)
--    Existen sobres de familia (Supermercado, Pañales, Colegio, Emergencia...)
--    y de empresa (Costos fijos pensionado, Impuestos, Reserva operativa...).
-- -----------------------------------------------------------------------------
create table sobres (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  ambito             ambito not null,
  unidad_negocio_id  uuid references unidades_negocio(id),
  nombre             text not null,
  tipo               tipo_sobre not null default 'gasto_mensual',
  grupo              text,                      -- agrupador visual: "Hijos", "Casa", "Caballos"
  meta_monto         bigint,                    -- objetivo total (emergencia/ahorro)
  meta_mensual       bigint,                    -- cuánto "necesita" por mes
  meta_fecha         date,
  prioridad          smallint not null default 100,  -- orden de llenado automático
  orden              smallint not null default 0,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz,
  constraint sobre_familia_sin_unidad check (ambito = 'empresa' or unidad_negocio_id is null)
);
create index on sobres (hogar_id, ambito);

-- Asignaciones: "darle un trabajo a cada peso". Solo se asigna dinero que YA existe
-- (ver vista v_listo_para_asignar). Montos negativos = desasignar / mover entre sobres.
create table asignaciones (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  sobre_id           uuid not null references sobres(id),
  mes                date not null check (mes = date_trunc('month', mes)::date),
  monto              bigint not null,
  nota               text,
  creado_por         uuid references usuarios(id),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz
);
create index on asignaciones (hogar_id, mes);
create index on asignaciones (sobre_id);

-- -----------------------------------------------------------------------------
-- 5. Deudores (clientes) y Cuentas por Cobrar
-- -----------------------------------------------------------------------------
create table deudores (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  unidad_negocio_id  uuid not null references unidades_negocio(id),
  nombre             text not null,
  telefono           text,                      -- para recordatorio por WhatsApp
  notas              text,
  tarifa_mensual     bigint,                    -- pensionado: cuota por caballo/box
  cantidad_unidades  integer default 1,         -- nº de caballos, bolsas fijas, etc.
  dia_vencimiento    smallint check (dia_vencimiento between 1 and 28),
  dias_gracia        smallint not null default 5,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz
);
create index on deudores (hogar_id, unidad_negocio_id);

-- Cargo = servicio prestado / venta a crédito / reserva. Es lo que el cliente DEBE.
create table cargos (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  unidad_negocio_id  uuid not null references unidades_negocio(id),
  deudor_id          uuid not null references deudores(id),
  concepto           text not null,             -- "Pensión noviembre - 2 caballos"
  periodo            date,                      -- mes de servicio (cargos recurrentes)
  moneda             moneda not null default 'ARS',  -- cabañas pueden cobrar en USD
  monto              bigint not null check (monto > 0),
  fecha_emision      date not null default current_date,
  fecha_vencimiento  date not null,
  probabilidad_cobro smallint not null default 100 check (probabilidad_cobro between 0 and 100),
  estado             estado_cargo not null default 'pendiente',  -- mantenido por trigger
  -- Cabañas: datos de reserva (null para otras unidades)
  reserva_desde      date,
  reserva_hasta      date,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz,
  constraint cargo_reserva_valida check (reserva_desde is null or reserva_hasta > reserva_desde),
  -- Evita duplicar la cuota mensual si dos dispositivos la generan offline
  constraint cargo_periodo_unico unique (deudor_id, periodo, concepto)
);
create index on cargos (hogar_id, estado, fecha_vencimiento);
create index on cargos (deudor_id);

-- -----------------------------------------------------------------------------
-- 6. Deudas propias (lo que la familia / empresa DEBE)
-- -----------------------------------------------------------------------------
create table deudas_propias (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  ambito             ambito not null,
  unidad_negocio_id  uuid references unidades_negocio(id),
  tipo               tipo_deuda not null default 'otro',
  acreedor           text not null,             -- "Plan Toyota Hilux", "Visa - materiales cabañas"
  descripcion        text,
  moneda             moneda not null default 'ARS',
  monto_original     bigint not null check (monto_original > 0),
  saldo_inicial      bigint not null check (saldo_inicial >= 0),  -- saldo al momento de cargarla
  tasa_anual         numeric(7,4) not null default 0,  -- TNA en %, ej 85.5000 (0 = cuotas sin interés)
  pago_minimo        bigint not null default 0,  -- en deudas en cuotas = valor de la cuota
  cuotas_total       smallint,                   -- compras en cuotas / plan de ahorro
  cuotas_pagadas_al_cargar smallint not null default 0,
  dia_vencimiento    smallint check (dia_vencimiento between 1 and 31),
  cuenta_tarjeta_id  uuid references cuentas(id),       -- tarjeta por la que se debita la cuota
  sobre_id           uuid references sobres(id),        -- sobre donde se presupuesta la cuota
  orden_manual       smallint,                          -- override de prioridad
  cancelada          boolean not null default false,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz
);
create index on deudas_propias (hogar_id, ambito);

-- -----------------------------------------------------------------------------
-- 7. El Embudo (sueldo FORZADO por cascada de prioridades)
--    Cada peso que entra a la empresa recorre las reglas en orden. Cada regla
--    tiene un tope mensual; cuando se llena, el resto cae a la siguiente.
--    Ej:  1. Alimento para reponer stock (sobre)   tope $900.000
--         2. Sueldo mínimo            (sueldo)     tope $600.000
--         3. Plan Hilux + seguros     (sobre)      tope $450.000
--         4. Sueldo completo          (sueldo)     tope $500.000  (el resto del objetivo)
--         5. Impuestos / reserva      (sobre)      tope $200.000
--    Lo que sobra queda "Listo para asignar" en la empresa.
--    El dinero de las reglas 'sueldo' va al sobre de empresa "Sueldo por
--    transferir": queda bloqueado para el negocio aunque físicamente no se haya
--    movido todavía. Al confirmar la transferencia real se crea el 'sueldo'.
-- -----------------------------------------------------------------------------
create table config_embudo (
  hogar_id               uuid primary key references hogares(id) on delete cascade,
  modo                   text not null default 'forzar' check (modo in ('sugerir', 'forzar')),
  sobre_sueldo_id        uuid references sobres(id),   -- sobre empresa tipo 'sueldo'
  cuenta_familia_id      uuid references cuentas(id),  -- destino habitual del sueldo
  actualizado_en         timestamptz not null default now()
);

create table reglas_embudo (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  orden              smallint not null,
  nombre             text not null,
  destino            destino_regla not null,
  sobre_id           uuid references sobres(id),       -- destino = 'sobre' (sobre de EMPRESA)
  tope_mensual       bigint not null check (tope_mensual > 0),
  porcentaje_max     numeric(5,2) check (porcentaje_max > 0 and porcentaje_max <= 100),
                     -- opcional: toma como máximo este % de cada ingreso (para no vaciar todo en un solo cobro)
  unidad_negocio_id  uuid references unidades_negocio(id),  -- null = aplica a ingresos de todas las unidades
  activa             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz,
  constraint regla_sobre_requiere_sobre check (destino <> 'sobre' or sobre_id is not null)
);
create index on reglas_embudo (hogar_id, orden);

-- -----------------------------------------------------------------------------
-- 8. Transacciones (libro mayor, append-mostly)
--    Convención de signo: monto > 0 entra a la cuenta, monto < 0 sale.
--    Una transferencia/sueldo son DOS filas con el mismo grupo_id.
-- -----------------------------------------------------------------------------
create table transacciones (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  cuenta_id          uuid not null references cuentas(id),
  ambito             ambito not null,               -- denormalizado desde la cuenta (trigger)
  unidad_negocio_id  uuid references unidades_negocio(id),
  tipo               tipo_transaccion not null,
  fecha              date not null default current_date,
  monto              bigint not null check (monto <> 0),
  descripcion        text,
  sobre_id           uuid references sobres(id),    -- en qué sobre impacta el gasto
  es_costo_fijo      boolean not null default false,
  grupo_id           uuid,                          -- enlaza las 2 patas de una transferencia
  deuda_id           uuid references deudas_propias(id),
  -- Dólares: "me pagaron US$ 300 y los pasé a pesos al promedio del día"
  moneda_original    moneda,                        -- si se cobró/pagó en otra moneda que la de la cuenta
  monto_original     bigint,
  tipo_cambio        numeric(14,4),                 -- cotización usada (también en conversiones USD->ARS)
  creado_por         uuid references usuarios(id),
  dispositivo_id     text,                          -- trazabilidad de la sincronización
  creado_en          timestamptz not null default now(),  -- hora del dispositivo
  sincronizado_en    timestamptz not null default now(),  -- hora del servidor
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz,
  constraint pago_deuda_requiere_deuda check (tipo <> 'pago_deuda' or deuda_id is not null),
  constraint transferencia_requiere_grupo check (
    tipo not in ('transferencia', 'sueldo', 'aporte_capital') or grupo_id is not null),
  constraint moneda_original_completa check (
    (moneda_original is null) = (monto_original is null) and
    (moneda_original is null or tipo_cambio is not null))
);
create index on transacciones (hogar_id, ambito, fecha desc);
create index on transacciones (cuenta_id);
create index on transacciones (sobre_id) where sobre_id is not null;
create index on transacciones (grupo_id) where grupo_id is not null;
create index on transacciones (hogar_id, actualizado_en);  -- pull incremental del sync

-- Aplicación de cobros a cargos (permite pagos parciales y un pago para varios meses)
create table cobros_aplicados (
  id                 uuid primary key,
  hogar_id           uuid not null references hogares(id) on delete cascade,
  transaccion_id     uuid not null references transacciones(id),
  cargo_id           uuid not null references cargos(id),
  monto              bigint not null check (monto > 0),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  eliminado_en       timestamptz,
  unique (transaccion_id, cargo_id)
);
create index on cobros_aplicados (cargo_id);

-- Cómo se repartió cada ingreso de la empresa en el Embudo (auditable).
-- Cada fila genera una asignación al sobre de la regla (o al sobre "Sueldo por transferir").
create table embudo_distribuciones (
  id                     uuid primary key,
  hogar_id               uuid not null references hogares(id) on delete cascade,
  transaccion_ingreso_id uuid not null references transacciones(id),
  regla_id               uuid not null references reglas_embudo(id),
  mes                    date not null check (mes = date_trunc('month', mes)::date),
  monto                  bigint not null check (monto > 0),
  asignacion_id          uuid references asignaciones(id),
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  eliminado_en           timestamptz,
  unique (transaccion_ingreso_id, regla_id)   -- un ingreso no se reparte dos veces
);
create index on embudo_distribuciones (hogar_id, mes);

-- =============================================================================
-- REGLAS DE NEGOCIO (triggers)
-- =============================================================================

-- R1. La transacción hereda ámbito y unidad de su cuenta; y el sobre debe ser del mismo ámbito.
--     Tarjeta compartida: el ámbito lo define el sobre del gasto (o el que
--     indique el cliente en los pagos del resumen).
create or replace function trx_validar_ambito() returns trigger
language plpgsql as $$
declare
  c cuentas%rowtype;
  s_ambito ambito;
  s_unidad uuid;
begin
  select * into c from cuentas where id = new.cuenta_id;
  if c.hogar_id <> new.hogar_id then
    raise exception 'La cuenta no pertenece al hogar';
  end if;
  if new.sobre_id is not null then
    select ambito, unidad_negocio_id into s_ambito, s_unidad from sobres where id = new.sobre_id;
  end if;
  new.unidad_negocio_id := coalesce(new.unidad_negocio_id, s_unidad);

  if c.compartida then
    new.ambito := coalesce(s_ambito, new.ambito);
    if new.ambito is null then
      raise exception 'Tarjeta compartida: indicá si el movimiento es de EMPRESA o de FAMILIA';
    end if;
  else
    new.ambito := c.ambito;
    new.unidad_negocio_id := coalesce(new.unidad_negocio_id, c.unidad_negocio_id);
  end if;

  if s_ambito is not null and s_ambito <> new.ambito then
    raise exception 'Separación de fondos: el sobre (%) y la cuenta (%) son de ámbitos distintos', s_ambito, new.ambito;
  end if;
  return new;
end $$;

create trigger trx_validar_ambito before insert or update on transacciones
for each row execute function trx_validar_ambito();

-- R2. Las patas de una transferencia deben sumar 0 (misma moneda) y respetar la
--     regla de cruce: solo 'sueldo' (empresa->familia) o 'aporte_capital'
--     (familia->empresa) pueden cruzar de ámbito. Se valida al final de la
--     transacción SQL (deferrable) porque las dos patas llegan juntas.
create or replace function trx_validar_transferencia() returns trigger
language plpgsql as $$
declare
  g uuid := coalesce(new.grupo_id, old.grupo_id);
  n int; suma bigint; amb_sale ambito; amb_entra ambito; t tipo_transaccion;
begin
  if g is null then return null; end if;

  select count(*), sum(monto),
         max(ambito::text) filter (where monto < 0)::ambito,
         max(ambito::text) filter (where monto > 0)::ambito,
         max(tipo::text)::tipo_transaccion
    into n, suma, amb_sale, amb_entra, t
    from transacciones where grupo_id = g and eliminado_en is null;

  if n = 0 then return null; end if;  -- ambas patas anuladas
  if n <> 2 then
    raise exception 'La transferencia % debe tener exactamente 2 movimientos (tiene %)', g, n;
  end if;
  if (select count(distinct tipo) from transacciones where grupo_id = g and eliminado_en is null) <> 1 then
    raise exception 'Las patas de la transferencia % tienen tipos distintos', g;
  end if;
  if suma <> 0 and not exists (
      select 1 from transacciones where grupo_id = g and tipo_cambio is not null) then
    raise exception 'La transferencia % no balancea (suma %)', g, suma;
  end if;

  if t = 'transferencia' and amb_sale <> amb_entra then
    raise exception 'Prohibido mezclar fondos: use el Embudo (sueldo) para pasar dinero de empresa a familia';
  elsif t = 'sueldo' and not (amb_sale = 'empresa' and amb_entra = 'familia') then
    raise exception 'Un sueldo solo puede ir de EMPRESA a FAMILIA';
  elsif t = 'aporte_capital' and not (amb_sale = 'familia' and amb_entra = 'empresa') then
    raise exception 'Un aporte de capital solo puede ir de FAMILIA a EMPRESA';
  end if;
  return null;
end $$;

create constraint trigger trx_validar_transferencia
after insert or update or delete on transacciones
deferrable initially deferred
for each row execute function trx_validar_transferencia();

-- R3. Estado del cargo se recalcula al aplicar/anular cobros.
create or replace function cargo_recalcular_estado() returns trigger
language plpgsql as $$
declare
  cid uuid := coalesce(new.cargo_id, old.cargo_id);
  pagado bigint;
begin
  select coalesce(sum(ca.monto), 0) into pagado
    from cobros_aplicados ca
    join transacciones t on t.id = ca.transaccion_id and t.eliminado_en is null
   where ca.cargo_id = cid and ca.eliminado_en is null;

  update cargos set estado = case
      when estado in ('anulado', 'incobrable') then estado
      when pagado >= monto then 'pagado'::estado_cargo
      when pagado > 0      then 'parcial'::estado_cargo
      else 'pendiente'::estado_cargo end
   where id = cid;
  return null;
end $$;

create trigger cobros_aplicados_estado after insert or update or delete on cobros_aplicados
for each row execute function cargo_recalcular_estado();

-- actualizado_en automático (clave para el pull incremental del sync)
do $$
declare t text;
begin
  foreach t in array array['hogares','usuarios','unidades_negocio','cuentas','sobres',
    'asignaciones','deudores','cargos','deudas_propias','reglas_embudo','embudo_distribuciones',
    'transacciones','cobros_aplicados','config_embudo','cotizaciones']
  loop
    execute format('create trigger %I_actualizado before update on %I
                    for each row execute function tocar_actualizado_en()', t, t);
  end loop;
end $$;

-- =============================================================================
-- VISTAS (lógica de lectura que alimenta el Dashboard)
-- =============================================================================

-- Cotización vigente del hogar: la manual del hogar si existe para la fecha más
-- reciente; si no, la automática. Promedio (compra+venta)/2.
create or replace function cotizacion_vigente(p_hogar uuid, p_fecha date default current_date)
returns numeric language sql stable as $$
  select promedio from cotizaciones
   where (hogar_id is null or hogar_id = p_hogar) and tipo = 'blue' and fecha <= p_fecha
   order by fecha desc, hogar_id nulls last
   limit 1
$$;

-- Saldo real por cuenta
create view v_saldo_cuentas with (security_invoker = true) as
select c.id, c.hogar_id, c.ambito, c.unidad_negocio_id, c.nombre, c.tipo, c.moneda,
       (c.saldo_inicial + coalesce(sum(t.monto) filter (where t.eliminado_en is null), 0))::bigint as saldo
  from cuentas c
  left join transacciones t on t.cuenta_id = c.id
 where c.eliminado_en is null
 group by c.id;

-- Cuentas por cobrar con antigüedad (semáforo de morosidad)
create view v_cuentas_por_cobrar with (security_invoker = true) as
select cg.id as cargo_id, cg.hogar_id, cg.unidad_negocio_id, cg.deudor_id, d.nombre as deudor,
       d.telefono, cg.concepto, cg.moneda, cg.monto, cg.fecha_vencimiento, cg.probabilidad_cobro,
       coalesce(p.pagado, 0)::bigint              as pagado,
       (cg.monto - coalesce(p.pagado, 0))::bigint as saldo,
       greatest(current_date - cg.fecha_vencimiento, 0) as dias_atraso,
       case
         when current_date <= cg.fecha_vencimiento                    then 'al_dia'
         when current_date <= cg.fecha_vencimiento + d.dias_gracia    then 'gracia'
         when current_date <= cg.fecha_vencimiento + 30               then 'atrasado'
         when current_date <= cg.fecha_vencimiento + 60               then 'moroso'
         else 'critico'
       end as semaforo
  from cargos cg
  join deudores d on d.id = cg.deudor_id
  left join lateral (
    select sum(ca.monto)::bigint as pagado
      from cobros_aplicados ca
      join transacciones t on t.id = ca.transaccion_id and t.eliminado_en is null
     where ca.cargo_id = cg.id and ca.eliminado_en is null
  ) p on true
 where cg.eliminado_en is null
   and cg.estado in ('pendiente', 'parcial');

-- Flujo del mes: esperado vs real, por unidad de negocio (solo EMPRESA)
create view v_flujo_mes with (security_invoker = true) as
with mes as (select date_trunc('month', current_date)::date as ini,
                    (date_trunc('month', current_date) + interval '1 month - 1 day')::date as fin)
select u.hogar_id, u.id as unidad_negocio_id, u.nombre,
       -- Esperado = saldo pendiente que vence este mes (o vencido), ponderado por probabilidad
       -- Todo expresado en PESOS: lo cobrado en dólares se convierte con la
       -- cotización usada en el momento (tipo_cambio) o la vigente.
       coalesce((select sum(cxc.saldo * cxc.probabilidad_cobro / 100
                            * case when cxc.moneda = 'USD' then coalesce(cot.v, 0) else 1 end)
                   from v_cuentas_por_cobrar cxc, mes
                  where cxc.unidad_negocio_id = u.id and cxc.fecha_vencimiento <= mes.fin), 0)::bigint
         as esperado_pendiente,
       coalesce((select sum(t.monto * case when c.moneda = 'USD'
                                           then coalesce(t.tipo_cambio, cot.v, 0) else 1 end)
                   from transacciones t join cuentas c on c.id = t.cuenta_id, mes
                  where t.unidad_negocio_id = u.id and t.eliminado_en is null
                    and t.tipo = 'ingreso' and t.fecha between mes.ini and mes.fin), 0)::bigint
         as cobrado_real,
       coalesce((select -sum(t.monto * case when c.moneda = 'USD'
                                            then coalesce(t.tipo_cambio, cot.v, 0) else 1 end)
                   from transacciones t join cuentas c on c.id = t.cuenta_id, mes
                  where t.unidad_negocio_id = u.id and t.eliminado_en is null
                    and t.tipo in ('gasto', 'pago_deuda') and t.fecha between mes.ini and mes.fin), 0)::bigint
         as gastado_real
  from unidades_negocio u
  cross join lateral (select cotizacion_vigente(u.hogar_id) as v) cot
 where u.eliminado_en is null;

-- Disponible por sobre (YNAB: asignado acumulado + actividad acumulada; arrastra saldo)
create view v_sobres_disponible with (security_invoker = true) as
select s.id as sobre_id, s.hogar_id, s.ambito, s.nombre, s.tipo, s.grupo,
       s.meta_monto, s.meta_mensual, s.prioridad,
       coalesce(a.asignado, 0)                                  as asignado_total,
       coalesce(a.asignado_mes, 0)                              as asignado_mes,
       coalesce(t.actividad, 0)                                 as actividad_total,
       coalesce(t.actividad_mes, 0)                             as actividad_mes,
       coalesce(a.asignado, 0) + coalesce(t.actividad, 0)       as disponible
  from sobres s
  left join (
    select sobre_id, sum(monto)::bigint as asignado,
           (sum(monto) filter (where mes = date_trunc('month', current_date)::date))::bigint as asignado_mes
      from asignaciones where eliminado_en is null and mes <= current_date
     group by sobre_id) a on a.sobre_id = s.id
  left join (
    select sobre_id, sum(monto)::bigint as actividad,
           (sum(monto) filter (where fecha >= date_trunc('month', current_date)))::bigint as actividad_mes
      from transacciones where eliminado_en is null and sobre_id is not null
     group by sobre_id) t on t.sobre_id = s.id
 where s.eliminado_en is null;

-- Deuda de tarjetas separada por ámbito: "del resumen de la Visa, $X es de la
-- empresa y $Y de la familia". saldo_inicial se atribuye al ámbito del titular.
create view v_tarjetas_por_ambito with (security_invoker = true) as
select c.id as cuenta_id, c.hogar_id, c.nombre, c.compartida, amb.ambito,
       (-(case when amb.ambito = c.ambito then c.saldo_inicial else 0 end
          + coalesce((select sum(t.monto) from transacciones t
                       where t.cuenta_id = c.id and t.ambito = amb.ambito
                         and t.eliminado_en is null), 0)))::bigint as deuda,
       -- Compras hechas DESDE que se usa la app y aún no pagadas: esa plata
       -- ya está "apartada" en las cuentas para pagar el resumen.
       greatest(-coalesce((select sum(t.monto) from transacciones t
                            where t.cuenta_id = c.id and t.ambito = amb.ambito
                              and t.eliminado_en is null), 0), 0)::bigint as compras_a_pagar
  from cuentas c
 cross join (values ('empresa'::ambito), ('familia'::ambito)) amb(ambito)
 where c.tipo = 'tarjeta_credito' and c.eliminado_en is null
   and (c.compartida or amb.ambito = c.ambito);

-- "Listo para asignar" por ámbito: dinero REAL en cuentas en pesos
--   − lo ya asignado a sobres (neto de lo gastado)
--   − lo gastado con tarjeta que todavía hay que pagar (ya salió de un sobre,
--     pero el efectivo sigue en la cuenta hasta pagar el resumen).
-- Nunca incluye cuentas por cobrar. Los dólares no se reparten hasta convertirlos.
create view v_listo_para_asignar with (security_invoker = true) as
select h.id as hogar_id, amb.ambito,
       (coalesce((select sum(saldo) from v_saldo_cuentas sc
                  where sc.hogar_id = h.id and sc.ambito = amb.ambito
                    and sc.tipo <> 'tarjeta_credito' and sc.moneda = h.moneda_base), 0)
     -- Un sobre pasado de gasto (negativo) NO libera plata: si se pasó con
     -- tarjeta, esa deuda ya se descuenta abajo; si fue en efectivo, ya salió de la cuenta.
     - coalesce((select sum(greatest(disponible, 0)) from v_sobres_disponible sd
                  where sd.hogar_id = h.id and sd.ambito = amb.ambito), 0)
     - coalesce((select sum(compras_a_pagar) from v_tarjetas_por_ambito tc
                  where tc.hogar_id = h.id and tc.ambito = amb.ambito), 0))::bigint
       as listo_para_asignar,
       coalesce((select sum(saldo) from v_saldo_cuentas sc
                  where sc.hogar_id = h.id and sc.ambito = amb.ambito
                    and sc.tipo <> 'tarjeta_credito' and sc.moneda = 'USD'), 0)::bigint
       as dolares_sin_convertir
  from hogares h
 cross join (values ('empresa'::ambito), ('familia'::ambito)) amb(ambito);

-- Avance del Embudo en el mes: cuánto se llenó cada regla y cuánto falta.
-- Para las reglas de sueldo: "la empresa todavía le debe $X a la familia".
create view v_embudo_mes with (security_invoker = true) as
select r.id as regla_id, r.hogar_id, r.orden, r.nombre, r.destino, r.sobre_id, r.tope_mensual,
       coalesce(d.cubierto, 0)::bigint                               as cubierto_mes,
       greatest(r.tope_mensual - coalesce(d.cubierto, 0), 0)::bigint as falta_mes
  from reglas_embudo r
  left join (
    select regla_id, sum(monto) as cubierto from embudo_distribuciones
     where eliminado_en is null and mes = date_trunc('month', current_date)::date
     group by regla_id) d on d.regla_id = r.id
 where r.activa and r.eliminado_en is null;

-- Deudas priorizadas según la estrategia del hogar
create view v_deudas_priorizadas with (security_invoker = true) as
select d.*, coalesce(p.pagado, 0) as pagado,
       (d.saldo_inicial - coalesce(p.pagado, 0))::bigint as saldo_actual,
       (d.cuotas_total - d.cuotas_pagadas_al_cargar - coalesce(p.cuotas, 0))::smallint as cuotas_restantes,
       round((d.saldo_inicial - coalesce(p.pagado, 0)) * d.tasa_anual / 100 / 12)::bigint as interes_mensual_estimado,
       row_number() over (
         partition by d.hogar_id
         order by d.orden_manual nulls last,
           case when h.estrategia_deuda = 'avalancha' then -d.tasa_anual end,
           case when h.estrategia_deuda = 'bola_de_nieve' then d.saldo_inicial - coalesce(p.pagado, 0) end,
           d.tasa_anual desc
       ) as prioridad
  from deudas_propias d
  join hogares h on h.id = d.hogar_id
  left join lateral (
    select (-sum(t.monto))::bigint as pagado, count(*) as cuotas from transacciones t
     where t.deuda_id = d.id and t.eliminado_en is null and t.tipo = 'pago_deuda'
  ) p on true
 where d.eliminado_en is null and not d.cancelada;

-- =============================================================================
-- SEGURIDAD: Row Level Security (cada hogar solo ve lo suyo)
-- =============================================================================
alter table hogares enable row level security;
create policy hogar_propio on hogares for all using (id = mi_hogar()) with check (id = mi_hogar());

alter table usuarios enable row level security;
create policy usuarios_del_hogar on usuarios for select using (hogar_id = mi_hogar());
create policy usuario_se_edita on usuarios for update using (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['unidades_negocio','cuentas','sobres','asignaciones','deudores',
    'cargos','deudas_propias','config_embudo','reglas_embudo','embudo_distribuciones',
    'transacciones','cobros_aplicados']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_hogar on %I for all
                    using (hogar_id = mi_hogar()) with check (hogar_id = mi_hogar())', t, t);
  end loop;
end $$;

-- Cotizaciones: todos leen las generales y las de su hogar; solo se cargan las del hogar.
alter table cotizaciones enable row level security;
create policy cotizaciones_lectura on cotizaciones for select
  using (hogar_id is null or hogar_id = mi_hogar());
create policy cotizaciones_manual on cotizaciones for insert
  with check (hogar_id = mi_hogar());
