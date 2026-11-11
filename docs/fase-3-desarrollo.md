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

## Pendiente (siguiente iteración)

1. **Service Worker** (Serwist) para abrir la app sin señal. Hoy los *datos* funcionan offline, pero la primera carga de la página necesita conexión.
2. **Login** (Supabase Auth con enlace por email) y alta del hogar; hoy solo está el modo demo.
3. Pantallas diseñadas en la Fase 2 que todavía muestran "próximamente": Me deben, Sobres, Debemos, Carga rápida (＋) y Más.
4. Edge Functions: cotización diaria del dólar y generación de las cuotas mensuales del pensionado.
5. Cuando dos teléfonos reparten ingresos sin señal al mismo tiempo, el tope mensual de una regla se puede pasar. Habría que agregar un ajuste en el servidor al sincronizar.
