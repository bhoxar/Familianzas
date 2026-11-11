# Familianzas · Fase 3 — Desarrollo del Core

Alcance de esta fase: **modelo de datos**, **Dashboard de Doble Perfil** y
**Módulo de Asignación de Sueldo (Embudo)**, funcionando sin señal.

## Cómo correrla

```bash
npm install
npm run dev        # http://localhost:3000  (modo demo: datos ficticios en el teléfono)
npm test           # 32 tests de dominio, base local y sincronización
npm run build      # compilación de producción
```

Sin `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` la app arranca
en **modo demo**: carga un hogar ficticio en IndexedDB y nunca envía nada a un
servidor. Con esas variables (ver `.env.example`) activa la sincronización.

Base de datos (Supabase): aplicar `supabase/migrations/0001_*.sql` y `0002_*.sql`.
Prueba de reglas en un Postgres local: `psql -d <bd_vacia> -f supabase/tests/reglas_negocio.sql`.

## Estructura

```
src/
├─ lib/dominio/          ← lógica pura, sin UI ni base de datos (testeable)
│  ├─ tipos.ts           modelo de datos: espejo 1:1 de las tablas + validaciones zod
│  ├─ utiles.ts          dinero en centavos, fechas, ids
│  ├─ embudo.ts          ★ cascada del sueldo: estado del mes, reparto, transferencia
│  ├─ calculos.ts        espejo TS de las vistas SQL (saldos, sobres, tarjetas, me deben, flujo)
│  └─ dashboard.ts       arma el Dashboard por ámbito + alerta única
├─ lib/offline/
│  ├─ db.ts              IndexedDB (Dexie): tablas espejo + cola `outbox` + meta
│  ├─ repositorio.ts     única puerta de escritura: valida, guarda y encola en un lote
│  └─ sync.ts            sube lotes con la RPC `sincronizar_lote`, baja cambios por cursor
├─ lib/estado/           interruptor global (Zustand) y hooks reactivos (useLiveQuery)
├─ lib/demo/             hogar de demostración (los ingresos pasan por el Embudo real)
├─ components/
│  ├─ DashboardDoblePerfil.tsx  ★ Inicio Negocio / Familia
│  ├─ ModuloSueldo.tsx          ★ Sueldo: deuda con la familia, pasar a Familia, cascada, cobro con vista previa
│  ├─ SelectorAmbito.tsx        interruptor 🐴 Negocio | 🏠 Familia (recolorea la app)
│  ├─ IndicadorSync.tsx  BarraNavegacion.tsx  Proveedor.tsx  ui.tsx
└─ app/                  rutas Next.js (App Router)
supabase/migrations/0002_sincronizacion.sql   RPC atómica e idempotente para la sync
```

## Decisiones de implementación

| Tema | Decisión |
|---|---|
| Separación de fondos | Se valida **dos veces**: en el teléfono (`resolverAmbito`, aviso instantáneo sin señal) y en Postgres (triggers, autoridad final). El Dashboard recibe datos de **un solo ámbito** por vez: la UI no puede mezclarlos porque nunca los tiene juntos. |
| Embudo forzado | Al registrar un ingreso del negocio en pesos, en el **mismo lote** se guardan la transacción, las asignaciones y las distribuciones. Antes de guardar, la pantalla muestra cómo se va a repartir. |
| Sueldo | "Apartado" (bloqueado en el sobre *Sueldo por transferir*) es distinto de "Ya pasado" (transferencia real confirmada con **Ya lo pasé ✓**). No se puede pasar más de lo que el Embudo ya apartó. |
| Sin señal | Toda escritura va a IndexedDB + `outbox`. Cada lote se sube con `sincronizar_lote`: todo o nada, y reenviarlo no duplica. Si el servidor rechaza un lote (por ejemplo, por mezcla de fondos), queda en "para revisar" y no frena a los demás. |
| Paridad SQL ↔ TS | `calculos.test.ts` reproduce el escenario de `reglas_negocio.sql` y exige los mismos números (incluido el −$68.000 de la cuota Hilux sin asignar). |

## Verificado

- 32 tests (Vitest): cascada, topes mensuales, % máximo por cobro, reglas por unidad, idempotencia, transferencia de sueldo, paridad con SQL, repositorio sobre IndexedDB y subida de lotes (aceptado, rechazado y sin red).
- SQL en Postgres 16: 4 operaciones prohibidas rechazadas; `sincronizar_lote` es idempotente y todo-o-nada.
- `next build` de producción OK.
- Navegador con tamaño de celular (Playwright): inicio de Familia y de Negocio, cobro con vista previa, "Ya lo pasé" y carga sin señal, sin errores de consola.

## Fase 3b — App completa

Agregado después del núcleo, para dejar la app usable de punta a punta:

| Área | Qué hay |
|---|---|
| **Acceso** | Entrada con enlace por email (Supabase Auth). Crear hogar o sumarse con un **código de 6 letras** (migración `0003_acceso.sql`). Sin Supabase, la app funciona **solo en el teléfono**. |
| **Configuración guiada** | 3 pasos: negocios, cuentas con saldos de hoy (la deuda de la tarjeta va a Debemos), y sueldo y costos. Con eso arma la cascada de prioridades, los sobres y el fondo de emergencia sugerido (3 meses). |
| **Carga rápida (＋)** | Monto, qué fue y de dónde. Solo muestra sobres y cuentas del modo actual; la tarjeta compartida toma el ámbito del sobre; muestra el equivalente en pesos cuando la cuenta es en dólares. |
| **Me deben** | Clientes agrupados por semáforo. Ficha con lo que debe mes a mes, cobro parcial (se aplica primero a lo más viejo; lo que sobra queda a favor), "¿va a pagar?" (seguro / quizás / difícil), incobrable, deudas sueltas (venta fiada, reserva) y WhatsApp. **Generar cuotas del mes** con id fijo por cliente y mes: no se duplica aunque los dos lo toquen sin señal. |
| **Sobres** | Plata sin destino, reparto automático por prioridad (cubre primero los sobres en rojo y no pasa la meta del fondo de emergencia), agregar, sacar, mover y editar sobres. No deja asignar plata que no existe. |
| **Debemos** | Avalancha o bola de nieve, deuda a atacar, registrar pagos (la cuota de la Hilux con la Visa va al resumen del Negocio) y simulador: meses e intereses con plata extra. Avisa si el mínimo no cubre el interés. |
| **Cuentas y tarjetas** | Saldos, altas y archivado de cuentas. Resumen de cada tarjeta dividido por partes, y cada parte paga lo suyo. |
| **Dólar** | Blue promedio automático una vez por día (con señal) o cargado a mano, y venta de dólares: los pesos del negocio pasan por el Embudo. |
| **Sueldo** | Agregar, editar, pausar y borrar pasos de la cascada. |
| **Sincronización** | Pendientes por subir y bandeja **Para revisar** (reintentar o descartar lo que el servidor rechazó). |
| **Sin señal** | Service worker propio (`public/sw.js`): guarda todas las pantallas al instalarse; las páginas usan primero la red y, sin señal, la copia guardada. App instalable con íconos. |

Guía para publicarla e instalarla: [puesta-en-marcha.md](puesta-en-marcha.md).

## Limitaciones conocidas

1. **Embudo con dos teléfonos sin señal**: si los dos registran cobros a la vez sin conexión, una regla puede pasarse de su tope mensual. Cada cobro se reparte una sola vez, pero el tope se controla con los datos de cada teléfono. Se corrige moviendo plata entre sobres.
2. **Cotización automática**: usa `dolarapi.com` (mismos valores que dolarhoy.com). No se pudo probar desde el entorno de desarrollo porque la red lo bloquea; si falla, la app avisa y se carga a mano.
3. **Acceso por email**: el código está hecho y las funciones SQL están probadas en Postgres, pero no hay un proyecto Supabase real para probar el envío del email y la vuelta a la app. Es lo primero a verificar al publicarla (ver la guía).
4. **Editar ediciones simultáneas** (por ejemplo, los dos cambian el mismo sobre sin señal): gana el último en sincronizar.
