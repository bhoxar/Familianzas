# Puesta en marcha

Hay dos formas de usar Familianzas.

| | Solo en un teléfono | Compartida (recomendada) |
|---|---|---|
| Qué hace falta | Publicar la app (paso 3) | Supabase + publicar la app (pasos 1 a 4) |
| Ambos ven lo mismo | ❌ | ✅ |
| Respaldo si se pierde el teléfono | ❌ | ✅ |
| Funciona sin señal | ✅ | ✅ (sincroniza al volver la señal) |
| Costo | Gratis | Gratis en los planes iniciales de Supabase y Vercel |

## 1. Crear la base de datos (Supabase)

1. Crear una cuenta en <https://supabase.com> y un proyecto nuevo. Región: **South America (São Paulo)**.
2. En **SQL Editor**, ejecutar en orden el contenido de:
   1. `supabase/migrations/0001_esquema_inicial.sql`
   2. `supabase/migrations/0002_sincronizacion.sql`
   3. `supabase/migrations/0003_acceso.sql`
3. En **Project Settings → API**, copiar la **Project URL** y la **anon public key**.

> La *anon key* es pública por diseño. La seguridad la dan las políticas de la
> base de datos: cada hogar solo ve y modifica lo suyo. Nunca usar la
> *service_role key* en la app.

## 2. Configurar el acceso por email

En **Authentication → URL Configuration**:

- **Site URL**: la dirección donde quede publicada la app (paso 3), por ejemplo `https://familianzas.vercel.app`.
- **Redirect URLs**: agregar esa misma dirección.

Opcional: en **Authentication → Email Templates** se puede traducir el email del enlace al español.

## 3. Publicar la app (Vercel)

1. Crear una cuenta en <https://vercel.com> e importar el repositorio de GitHub.
2. En **Environment Variables** cargar:
   - `NEXT_PUBLIC_SUPABASE_URL` = la Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = la anon public key

   Para usarla **solo en un teléfono**, no cargar estas variables.
3. Deploy.

## 4. Instalar en los teléfonos

1. Abrir la dirección publicada en el celular (Chrome en Android, Safari en iPhone).
2. Menú del navegador → **Agregar a la pantalla de inicio**. Queda como una app más.
3. **Primera persona:** entrar con su email, tocar el enlace que llega y elegir **Crear hogar**. Después completar la configuración guiada.
4. **Segunda persona:** en el teléfono de la primera, abrir **Más → Usuarios del hogar** y copiar el código de 6 letras. Entrar con su propio email, elegir **Tengo un código** y escribirlo.

> Abrir la app al menos una vez **con señal** después de instalarla: en ese
> momento guarda todo lo necesario para funcionar sin señal en el campo.

## Desarrollo local

```bash
npm install
npm run dev            # http://localhost:3000 (sin variables: modo demo)
npm test               # tests de dominio, base local y sincronización
npm run build
```

Prueba de las reglas de la base de datos en un Postgres 15 o superior vacío:

```bash
psql -d <bd_vacia> -f supabase/tests/reglas_negocio.sql
```

Las líneas marcadas "(debe FALLAR)" tienen que mostrar ERROR; el resto, no.
