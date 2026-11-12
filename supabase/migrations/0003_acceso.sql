-- =============================================================================
-- Familianzas · Migración 0003 · Alta de hogar y acceso compartido
--
-- Flujo: la primera persona inicia sesión (enlace por email) y llama a
-- crear_hogar(). Recibe un código de invitación de 6 letras; la otra persona
-- inicia sesión y llama a unirse_hogar(código). Ambas ven el mismo hogar.
-- =============================================================================

alter table hogares
  add column codigo_invitacion text unique
  default upper(substr(md5(gen_random_uuid()::text), 1, 6));

create or replace function crear_hogar(p_nombre text, p_nombre_usuario text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión'; end if;
  if exists (select 1 from usuarios where id = auth.uid()) then
    raise exception 'Tu usuario ya pertenece a un hogar';
  end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Poné un nombre para el hogar'; end if;

  insert into hogares (nombre) values (trim(p_nombre)) returning id into h;
  insert into usuarios (id, hogar_id, nombre, rol)
       values (auth.uid(), h, coalesce(nullif(trim(p_nombre_usuario), ''), 'Yo'), 'admin');
  insert into config_embudo (hogar_id) values (h);
  return h;
end $$;

create or replace function unirse_hogar(p_codigo text, p_nombre_usuario text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión'; end if;
  if exists (select 1 from usuarios where id = auth.uid()) then
    raise exception 'Tu usuario ya pertenece a un hogar';
  end if;
  select id into h from hogares where codigo_invitacion = upper(trim(p_codigo));
  if h is null then raise exception 'El código no es válido'; end if;

  insert into usuarios (id, hogar_id, nombre, rol)
       values (auth.uid(), h, coalesce(nullif(trim(p_nombre_usuario), ''), 'Yo'), 'miembro');
  return h;
end $$;

revoke all on function crear_hogar(text, text) from public;
revoke all on function unirse_hogar(text, text) from public;
grant execute on function crear_hogar(text, text) to authenticated;
grant execute on function unirse_hogar(text, text) to authenticated;

-- La cotización manual del día se puede corregir (upsert desde la sincronización)
create policy cotizaciones_manual_editar on cotizaciones for update
  using (hogar_id = mi_hogar()) with check (hogar_id = mi_hogar());
