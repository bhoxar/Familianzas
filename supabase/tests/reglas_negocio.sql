-- Prueba de reglas de negocio (Postgres 15+ local, NO correr en producción).
-- Uso, desde la raíz del repo, sobre una BD vacía:
--   psql -d <bd_vacia> -f supabase/tests/reglas_negocio.sql
-- Las líneas "(debe FALLAR)" tienen que mostrar ERROR; el resto no.

-- Stub mínimo del esquema auth de Supabase
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
\i supabase/migrations/0001_esquema_inicial.sql
\i supabase/migrations/0002_sincronizacion.sql
\i supabase/migrations/0003_acceso.sql

\set ON_ERROR_STOP 0
\set H '''00000000-0000-0000-0000-000000000001'''
insert into hogares(id,nombre) values (:H,'Familia');
insert into unidades_negocio(id,hogar_id,nombre,tipo) values
 ('00000000-0000-0000-0000-0000000000a1',:H,'Pensionado','pensionado'),
 ('00000000-0000-0000-0000-0000000000a2',:H,'Alimento','alimento');
insert into cuentas(id,hogar_id,ambito,unidad_negocio_id,nombre,tipo,moneda,compartida) values
 ('00000000-0000-0000-0000-0000000000c1',:H,'empresa',null,'Banco Empresa','banco','ARS',false),
 ('00000000-0000-0000-0000-0000000000c2',:H,'familia',null,'Billetera Familiar','billetera_virtual','ARS',false),
 ('00000000-0000-0000-0000-0000000000c3',:H,'empresa','00000000-0000-0000-0000-0000000000a2','Dólares Alimento','efectivo','USD',false),
 ('00000000-0000-0000-0000-0000000000c4',:H,'familia',null,'Visa','tarjeta_credito','ARS',true);
insert into sobres(id,hogar_id,ambito,unidad_negocio_id,nombre,tipo) values
 ('00000000-0000-0000-0000-0000000000f1',:H,'familia',null,'Súper','gasto_mensual'),
 ('00000000-0000-0000-0000-0000000000f2',:H,'empresa','00000000-0000-0000-0000-0000000000a2','Nafta y peajes','costo_fijo'),
 ('00000000-0000-0000-0000-0000000000f3',:H,'empresa',null,'Sueldo por transferir','sueldo'),
 ('00000000-0000-0000-0000-0000000000f4',:H,'empresa','00000000-0000-0000-0000-0000000000a2','Plan Hilux','deuda');
insert into cotizaciones(fecha,compra,venta) values (current_date, 1400, 1420);

\echo '=== 1. ingreso empresa $500.000 (el cliente manda ámbito equivocado; la BD lo corrige)'
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,unidad_negocio_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c1','familia','ingreso',50000000,'00000000-0000-0000-0000-0000000000a1');

\echo '=== 2. (debe FALLAR) transferencia común empresa -> familia'
begin;
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,grupo_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c1','empresa','transferencia',-100,'00000000-0000-0000-0000-0000000000e1'),
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c2','empresa','transferencia',100,'00000000-0000-0000-0000-0000000000e1');
commit;

\echo '=== 3. (debe FALLAR) gasto de empresa en sobre familiar'
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,sobre_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c1','empresa','gasto',-100,'00000000-0000-0000-0000-0000000000f1');

\echo '=== 4. Embudo: reglas en cascada (stock primero, después sueldo mínimo)'
insert into reglas_embudo(id,hogar_id,orden,nombre,destino,sobre_id,tope_mensual) values
 ('00000000-0000-0000-0000-0000000001b1',:H,1,'Nafta y peajes','sobre','00000000-0000-0000-0000-0000000000f2',15000000),
 ('00000000-0000-0000-0000-0000000001b2',:H,2,'Sueldo mínimo','sueldo','00000000-0000-0000-0000-0000000000f3',60000000);
-- El ingreso de $500.000 se repartió: 150.000 a nafta, 350.000 al sueldo (faltan 250.000)
insert into asignaciones(id,hogar_id,sobre_id,mes,monto) values
 ('00000000-0000-0000-0000-0000000002a1',:H,'00000000-0000-0000-0000-0000000000f2',date_trunc('month',current_date),15000000),
 ('00000000-0000-0000-0000-0000000002a2',:H,'00000000-0000-0000-0000-0000000000f3',date_trunc('month',current_date),35000000);
insert into embudo_distribuciones(id,hogar_id,transaccion_ingreso_id,regla_id,mes,monto,asignacion_id)
 select gen_random_uuid(),:H,(select id from transacciones where tipo='ingreso' limit 1),r,date_trunc('month',current_date),m,a
   from (values ('00000000-0000-0000-0000-0000000001b1'::uuid,15000000,'00000000-0000-0000-0000-0000000002a1'::uuid),
                ('00000000-0000-0000-0000-0000000001b2'::uuid,35000000,'00000000-0000-0000-0000-0000000002a2'::uuid)) v(r,m,a);
\echo '--- se confirma la transferencia real del sueldo: $300.000 (sale del sobre Sueldo por transferir)'
begin;
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,grupo_id,sobre_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c1','empresa','sueldo',-30000000,'00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000f3'),
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c2','empresa','sueldo',30000000,'00000000-0000-0000-0000-0000000000e2',null);
commit;
insert into asignaciones(id,hogar_id,sobre_id,mes,monto) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000f1',date_trunc('month',current_date),12000000);

\echo '=== 5. Cobranza: cargo $80.000 vencido hace 40 días, cobro parcial $50.000'
insert into deudores(id,hogar_id,unidad_negocio_id,nombre) values ('00000000-0000-0000-0000-0000000000d1',:H,'00000000-0000-0000-0000-0000000000a1','Juan');
insert into cargos(id,hogar_id,unidad_negocio_id,deudor_id,concepto,monto,fecha_vencimiento) values
 ('00000000-0000-0000-0000-0000000000b1',:H,'00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','Pensión',8000000,current_date-40);
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,unidad_negocio_id) values
 ('00000000-0000-0000-0000-0000000000ab',:H,'00000000-0000-0000-0000-0000000000c1','empresa','ingreso',5000000,'00000000-0000-0000-0000-0000000000a1');
insert into cobros_aplicados(id,hogar_id,transaccion_id,cargo_id,monto) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000ab','00000000-0000-0000-0000-0000000000b1',5000000);

\echo '=== 6. Dólares: venta de alimento cobrada US$ 300, se convierten US$ 200 al promedio 1410'
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c3','empresa','ingreso',30000);
begin;
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,grupo_id,tipo_cambio) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c3','empresa','transferencia',-20000,'00000000-0000-0000-0000-0000000000e3',1410),
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c1','empresa','transferencia',28200000,'00000000-0000-0000-0000-0000000000e3',1410);
commit;

\echo '=== 7. Tarjeta compartida: nafta $40.000 (empresa) y súper $25.000 (familia) en la misma Visa'
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,sobre_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c4',null,'gasto',-4000000,'00000000-0000-0000-0000-0000000000f2'),
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c4',null,'gasto',-2500000,'00000000-0000-0000-0000-0000000000f1');
\echo '--- (debe FALLAR) gasto en tarjeta compartida sin sobre ni ámbito'
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c4',null,'gasto',-100);
\echo '--- la empresa paga SU parte del resumen ($40.000)'
begin;
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,grupo_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c1','empresa','transferencia',-4000000,'00000000-0000-0000-0000-0000000000e4'),
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c4','empresa','transferencia',4000000,'00000000-0000-0000-0000-0000000000e4');
commit;
\echo '--- (debe FALLAR) la familia intenta pagar la parte de la empresa'
begin;
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,grupo_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c2','familia','transferencia',-100,'00000000-0000-0000-0000-0000000000e5'),
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c4','empresa','transferencia',100,'00000000-0000-0000-0000-0000000000e5');
commit;

\echo '=== 8. Deudas: Plan Hilux (cuota debitada en la Visa) y tarjeta vieja'
insert into deudas_propias(id,hogar_id,ambito,tipo,acreedor,monto_original,saldo_inicial,tasa_anual,pago_minimo,cuotas_total,cuotas_pagadas_al_cargar,cuenta_tarjeta_id,sobre_id) values
 ('00000000-0000-0000-0000-0000000003d1',:H,'empresa','plan_ahorro','Plan Toyota Hilux',4800000000,3600000000,0,40000000,120,30,'00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000f4'),
 (gen_random_uuid(),:H,'familia','tarjeta','Saldo viejo Visa',100000000,90000000,120,9000000,null,0,null,null);
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,sobre_id,deuda_id) values
 (gen_random_uuid(),:H,'00000000-0000-0000-0000-0000000000c4',null,'pago_deuda',-40000000,'00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000003d1');

\echo '=== RESULTADOS'
select nombre, ambito, moneda, saldo/100 as saldo from v_saldo_cuentas order by nombre;
select deudor, saldo/100 saldo, dias_atraso, semaforo from v_cuentas_por_cobrar;
select nombre, esperado_pendiente/100 esperado, cobrado_real/100 cobrado, gastado_real/100 gastado from v_flujo_mes order by nombre;
select nombre, ambito, deuda/100 deuda, compras_a_pagar/100 a_pagar from v_tarjetas_por_ambito order by ambito;
select ambito, listo_para_asignar/100 lpa, dolares_sin_convertir/100 usd from v_listo_para_asignar order by ambito;
select nombre, ambito, disponible/100 disponible from v_sobres_disponible order by ambito, nombre;
select orden, nombre, cubierto_mes/100 cubierto, falta_mes/100 falta from v_embudo_mes order by orden;
select acreedor, saldo_actual/100 saldo, cuotas_restantes, interes_mensual_estimado/100 interes, prioridad from v_deudas_priorizadas order by prioridad;

\echo '=== 9. Acceso: crear hogar e invitar'
insert into auth.users values ('00000000-0000-0000-0000-00000000aaa1'), ('00000000-0000-0000-0000-00000000aaa2');
\echo '--- (debe FALLAR) sin sesión'
select crear_hogar('X', 'Y');
set app.uid = '00000000-0000-0000-0000-00000000aaa1';
select crear_hogar('Familia Nueva', 'Agustina') is not null as hogar_creado;
\echo '--- (debe FALLAR) crear un segundo hogar'
select crear_hogar('Otro', 'Agustina');
\echo '--- (debe FALLAR) código inválido'
set app.uid = '00000000-0000-0000-0000-00000000aaa2';
select unirse_hogar('ZZZZZZ', 'Pareja');
select unirse_hogar((select codigo_invitacion from hogares where nombre = 'Familia Nueva'), 'Pareja') =
       (select id from hogares where nombre = 'Familia Nueva') as se_unio;
select rol, count(*) from usuarios group by rol order by rol;

\echo '=== 10. Aislamiento entre hogares (RLS) como usuario común'
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on auth.users to authenticated;
set role authenticated;
set app.uid = '00000000-0000-0000-0000-00000000aaa2';
select count(*) as cuentas_ajenas_visibles from cuentas;  -- el hogar de prueba 1 tiene 4: debe dar 0
\echo '--- (debe FALLAR) escribir en el hogar de otro vía sincronizar_lote'
select sincronizar_lote('[{"tabla":"unidades_negocio","fila":{"id":"20000000-0000-0000-0000-000000000001","hogar_id":"00000000-0000-0000-0000-000000000001","nombre":"Intrusa","tipo":"otro","activa":true,"creado_en":"2026-11-11T00:00:00Z","actualizado_en":"2026-11-11T00:00:00Z"}}]');
select sincronizar_lote(('[{"tabla":"unidades_negocio","fila":{"id":"20000000-0000-0000-0000-000000000002","hogar_id":"' || mi_hogar() || '","nombre":"Pensionado","tipo":"pensionado","activa":true,"creado_en":"2026-11-11T00:00:00Z","actualizado_en":"2026-11-11T00:00:00Z"}}]')::jsonb) \gset x
select nombre as unidad_propia_creada from unidades_negocio;
reset role;
