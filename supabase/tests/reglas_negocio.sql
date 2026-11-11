-- Prueba de reglas de negocio (Postgres local, NO correr en producción).
-- Uso: psql -f supabase/tests/reglas_negocio.sql sobre una BD vacía.
-- Incluye un stub mínimo del esquema auth de Supabase.
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;
\i supabase/migrations/0001_esquema_inicial.sql
\set ON_ERROR_STOP 0
insert into hogares(id,nombre) values ('00000000-0000-0000-0000-000000000001','Familia');
insert into unidades_negocio(id,hogar_id,nombre,tipo) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Pensionado','pensionado');
insert into cuentas(id,hogar_id,ambito,unidad_negocio_id,nombre,tipo) values
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000001','empresa','00000000-0000-0000-0000-0000000000a1','Banco Empresa','banco'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000001','familia',null,'Billetera Familiar','billetera_virtual');
insert into sobres(id,hogar_id,ambito,nombre) values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000001','familia','Super');
\echo '--- ingreso empresa 500.000'
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto) values (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','familia','ingreso',50000000);
\echo '--- (debe FALLAR) transferencia comun empresa->familia'
begin;
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,grupo_id) values
 (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','empresa','transferencia',-100,'00000000-0000-0000-0000-0000000000e1'),
 (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2','empresa','transferencia',100,'00000000-0000-0000-0000-0000000000e1');
commit;
\echo '--- (debe FALLAR) gasto empresa en sobre familiar'
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,sobre_id) values (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','empresa','gasto',-100,'00000000-0000-0000-0000-0000000000f1');
\echo '--- sueldo 300.000 (OK)'
begin;
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto,grupo_id) values
 (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','empresa','sueldo',-30000000,'00000000-0000-0000-0000-0000000000e2'),
 (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2','empresa','sueldo',30000000,'00000000-0000-0000-0000-0000000000e2');
commit;
insert into asignaciones(id,hogar_id,sobre_id,mes,monto) values (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',date_trunc('month',current_date),12000000);
\echo '--- cobranza: cargo 80.000, cobro parcial 50.000'
insert into deudores(id,hogar_id,unidad_negocio_id,nombre) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Juan');
insert into cargos(id,hogar_id,unidad_negocio_id,deudor_id,concepto,monto,fecha_vencimiento) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','Pension',8000000,current_date-40);
insert into transacciones(id,hogar_id,cuenta_id,ambito,tipo,monto) values ('00000000-0000-0000-0000-0000000000ab','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','empresa','ingreso',5000000);
insert into cobros_aplicados(id,hogar_id,transaccion_id,cargo_id,monto) values (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000ab','00000000-0000-0000-0000-0000000000b1',5000000);
insert into deudas_propias(id,hogar_id,ambito,acreedor,monto_original,saldo_inicial,tasa_anual) values
 (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','familia','Visa',100000000,90000000,120),
 (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','familia','Prestamo tio',20000000,20000000,0);
select nombre, ambito, saldo/100 as pesos from v_saldo_cuentas;
select deudor, saldo/100 saldo, dias_atraso, semaforo from v_cuentas_por_cobrar;
select estado from cargos;
select nombre, esperado_pendiente/100 esperado, cobrado_real/100 cobrado from v_flujo_mes;
select ambito, listo_para_asignar/100 lpa from v_listo_para_asignar;
select acreedor, saldo_actual/100, interes_mensual_estimado/100, prioridad from v_deudas_priorizadas;
