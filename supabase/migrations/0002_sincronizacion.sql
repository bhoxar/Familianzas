-- =============================================================================
-- Familianzas · Migración 0002 · Sincronización offline
--
-- sincronizar_lote(cambios jsonb): aplica en UNA transacción un lote de filas
-- generadas offline. Un lote es, por ejemplo: un cobro + sus asignaciones y
-- distribuciones del Embudo, o las dos patas de un sueldo. O entra todo o no
-- entra nada (y los triggers de separación de fondos se evalúan al final).
--
-- Formato: [{"tabla": "transacciones", "fila": {...}}, ...]  en orden de dependencias.
-- Idempotente: reintentar el mismo lote no duplica (upsert por clave primaria).
-- SECURITY INVOKER: corre con los permisos del usuario, así RLS sigue aplicando.
-- =============================================================================
create or replace function sincronizar_lote(cambios jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  c        jsonb;
  tabla    text;
  cols     text;
  sets     text;
  pk       text;
  permitidas constant text[] := array[
    'unidades_negocio','cuentas','sobres','asignaciones','deudores','cargos',
    'deudas_propias','config_embudo','reglas_embudo','embudo_distribuciones',
    'transacciones','cobros_aplicados','cotizaciones'];
begin
  if jsonb_typeof(cambios) <> 'array' then
    raise exception 'El lote debe ser un arreglo';
  end if;

  for c in select value from jsonb_array_elements(cambios) loop
    tabla := c->>'tabla';
    if tabla is null or not tabla = any(permitidas) then
      raise exception 'Tabla no sincronizable: %', tabla;
    end if;

    -- Columnas presentes en la fila (las generadas y las de servidor se ignoran)
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
           string_agg(format('%1$I = excluded.%1$I', column_name), ', ' order by ordinal_position)
             filter (where column_name not in ('id', 'hogar_id', 'creado_en'))
      into cols, sets
      from information_schema.columns
     where table_schema = 'public' and table_name = tabla
       and is_generated = 'NEVER'
       and column_name not in ('sincronizado_en')
       and column_name in (select jsonb_object_keys(c->'fila'));

    select a.attname into pk
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = format('public.%I', tabla)::regclass and i.indisprimary;

    execute format(
      'insert into %1$I (%2$s) select %2$s from jsonb_populate_record(null::%1$I, $1)
       on conflict (%3$I) do %4$s',
      tabla, cols, pk,
      case when sets is null then 'nothing' else 'update set ' || sets end)
    using c->'fila';
  end loop;
end $$;

grant execute on function sincronizar_lote(jsonb) to authenticated;
