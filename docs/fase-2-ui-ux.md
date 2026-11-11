# Familianzas · Fase 2 — UI/UX y Navegación

> Objetivo: que cargar un gasto en el campo tome **3 toques y menos de 10
> segundos**, y que al abrir la app se entienda la situación **en un vistazo**,
> sin planillas ni jerga contable.

---

## 1. Principios de experiencia

1. **Dos casas, nunca mezcladas.** Un interruptor arriba cambia entre **Negocio** y **Familia**. Cambia el color de toda la app y *todo* lo que se ve: cuentas, sobres, deudas, tarjetas (solo la parte que corresponde).
2. **Una pregunta por pantalla.** El Inicio muestra como máximo **4 tarjetas** y **una sola alerta roja** a la vez (la más urgente).
3. **Palabras de la casa, no de contador.**

   | Concepto técnico | Cómo se llama en la app |
   |---|---|
   | Listo para asignar | **Plata sin destino** |
   | Cuentas por cobrar | **Me deben** |
   | Deudas propias | **Debemos** |
   | Embudo / asignación de sueldo | **Sueldo** |
   | Sobres / presupuesto base cero | **Sobres** |
   | Ámbito empresa / familia | **Negocio / Familia** |

4. **Pensada para el campo.** Botones de 48 px como mínimo, números grandes con alto contraste para leer bajo el sol, uso con una mano (las acciones abajo) y sin depender de la señal.
5. **El dinero que no llegó no existe.** Lo que les deben se muestra siempre en gris o como "esperado"; nunca suma a la plata disponible.

---

## 2. Interruptor Negocio / Familia

```
┌────────────────────────────────────┐
│ [ 🐴 Negocio │  🏠 Familia ]   ⟳ 2 │  ← interruptor + estado de sincronización
└────────────────────────────────────┘
```

- **Negocio**: color principal azul petróleo. **Familia**: verde.
- Se recuerda el último modo de cada usuario (`usuarios.modo_preferido`).
- El ícono **⟳ 2** muestra los movimientos guardados en el teléfono que todavía no se subieron. Si se toca, se ve la lista y la bandeja **"Para revisar"** (lo que el servidor rechazó, por ejemplo un intento de mezclar fondos).
- Debajo del interruptor, en modo Negocio, hay un **filtro por unidad**: `Todos · Pensionado · Alimento · Cabañas`.

---

## 3. Estructura de navegación

Barra inferior de 5 posiciones, con el botón **＋** siempre en el centro. Las pestañas cambian según el modo:

```
NEGOCIO   │ Inicio │ Me deben │  ＋  │ Sueldo │ Más │
FAMILIA   │ Inicio │  Sobres  │  ＋  │ Debemos│ Más │
```

**Más** (lista simple):

| Negocio | Familia |
|---|---|
| Sobres del negocio (stock, nafta, impuestos) | Metas: Fondo de emergencia, Ahorro |
| Cuentas y dólares | Cuentas |
| Tarjetas (parte del negocio) | Tarjetas (parte familiar) |
| Deudas del negocio (Plan Hilux, proveedores) | Historial de sueldos recibidos |
| Clientes y unidades de negocio | |
| Reglas del sueldo (cascada) | |
| **Comunes:** Cotización del dólar · Sincronización · Usuarios del hogar · Configuración | |

### Mapa de pantallas (rutas Next.js)

```
/                       → redirige a /negocio o /familia según el modo guardado
/negocio                Inicio Negocio
/negocio/me-deben       Lista por semáforo
/negocio/me-deben/[id]  Ficha del cliente
/negocio/sueldo         Cascada del Embudo
/negocio/sobres         Sobres del negocio
/familia                Inicio Familia
/familia/sobres         Sobres y metas
/familia/debemos        Deudas y plan de salida
/cuentas  /tarjetas  /dolar  /config  /sync
/nuevo                  Carga rápida (hoja inferior, también desde ＋)
/bienvenida             Configuración inicial guiada
```

---

## 4. Inicio — modo NEGOCIO

```
┌────────────────────────────────────┐
│ [🐴 Negocio | 🏠 Familia]      ⟳ 0 │
│ Todos · Pensionado · Alimento · …  │
├────────────────────────────────────┤
│ ⚠ Faltan $68.000                   │  ← UNA alerta, la más urgente
│ Se gastó con tarjeta más de lo que │
│ había. [Ver cómo cubrirlo]         │
├────────────────────────────────────┤
│ NOVIEMBRE                          │
│ Cobrado     $ 973.000  ███████░░░  │
│ Esperado    $ 310.000  ░░░ (gris)  │
│ Gastado     $ 440.000              │
├────────────────────────────────────┤
│ SUELDO DE LA FAMILIA               │
│ $350.000 de $600.000   ██████░░░░  │
│ Para pasar: $50.000                │
│ [ Pasar $50.000 a Familia ➜ ]      │
├────────────────────────────────────┤
│ ME DEBEN  $ 310.000 · 4 clientes   │
│ 🔴 Juan P.   $30.000   40 días [💬]│
│ 🟠 Haras X   $120.000  18 días [💬]│
│ Ver todos ›                        │
├────────────────────────────────────┤
│ US$ 100 sin convertir ≈ $141.000   │  ← solo si hay dólares
└────────────────────────────────────┘
 │ Inicio │ Me deben │ ＋ │ Sueldo │ Más │
```

**Orden de la alerta única** (se muestra la primera que aplique):
1. Plata sin destino negativa (se gastó plata que no había).
2. Vencimiento de tarjeta o cuota en ≤ 3 días sin plata en su sobre.
3. Cliente en rojo (más de 60 días).
4. Sueldo mínimo sin cubrir y el mes termina en ≤ 7 días.

---

## 5. Inicio — modo FAMILIA

```
┌────────────────────────────────────┐
│ [🐴 Negocio | 🏠 Familia]      ⟳ 0 │
├────────────────────────────────────┤
│ PLATA SIN DESTINO                  │
│        $ 180.000                   │
│ [ Repartir en sobres ]             │
├────────────────────────────────────┤
│ SOBRES QUE NECESITAN ATENCIÓN      │
│ 🍼 Bebé (pañales/leche)  $8.000 ▓░ │
│ 🛒 Súper                $95.000 ▓▓ │
│ Ver todos ›                        │
├────────────────────────────────────┤
│ FONDO DE EMERGENCIA                │
│ $ 250.000 de $ 1.800.000  ██░░░░░  │
│ (1 de 3 meses de gastos)           │
├────────────────────────────────────┤
│ PRÓXIMO PAGO                       │
│ Visa (parte familiar) $25.000 · 10/12│
│ Sueldo recibido este mes: $300.000 │
└────────────────────────────────────┘
 │ Inicio │ Sobres │ ＋ │ Debemos │ Más │
```

---

## 6. Carga rápida (botón ＋)

Se abre como una hoja desde abajo y **funciona sin señal**.

```
Paso 1               Paso 2                    Paso 3
┌──────────────┐    ┌───────────────────┐    ┌───────────────────┐
│ $ | US$      │    │ ¿Qué fue?         │    │ ¿De dónde salió?  │
│   40.000     │    │ ⛽ Nafta y peajes │    │ 💳 Visa ✓ (último)│
│ [1][2][3]    │ ─▶ │ 🛒 Súper          │ ─▶ │ 🏦 Banco Negocio  │
│ [4][5][6]    │    │ 🐴 Alimento stock │    │ 💵 Caja           │
│ [7][8][9]    │    │ (los más usados)  │    │ [ Guardar ]       │
│ Gasto|Ingreso│    └───────────────────┘    └───────────────────┘
│ |Cobro       │
└──────────────┘
```

- **Primero el monto**, que es lo que más rápido se recuerda.
- Solo aparecen los sobres del modo actual: en Negocio no se puede elegir "Súper".
- Con **tarjeta compartida**, el sobre decide qué parte paga: Nafta → Negocio.
- **US$**: muestra "1 US$ = $1.410 (promedio blue de hoy)", y se puede tocar para corregirlo.
- Al guardar: **"Guardado ✓"**, o **"Guardado en el teléfono ⏳, se sube cuando haya señal"**.
- **Cobro**: se elige el cliente, aparece lo que debe y el pago se aplica primero a la deuda más vieja (se puede cambiar). Al guardar, la app muestra cómo se repartió en el Embudo:
  > "Este cobro de $500.000 fue: $150.000 a Nafta · $350.000 al Sueldo"

---

## 7. Me deben (Negocio)

```
┌────────────────────────────────────┐
│ ME DEBEN  $310.000                 │
│ [Generar cuotas de diciembre]      │  ← pensionado: crea los cargos del mes
├────────────────────────────────────┤
│ 🔴 MÁS DE 60 DÍAS                  │
│   Pedro G.  $45.000  · 75 d   [💬] │
│ 🟠 31–60 DÍAS                      │
│   Juan P.   $30.000  · 40 d   [💬] │
│ 🟡 EN GRACIA / HASTA 30 DÍAS       │
│ 🟢 AL DÍA                          │
└────────────────────────────────────┘
```

**Ficha del cliente:** caballos o unidades, tarifa, historial de pagos y lo que debe mes a mes. Acciones:
- **Registrar cobro**
- **💬 Recordar por WhatsApp**, con un mensaje armado que se puede editar: *"Hola Juan, te recuerdo la pensión de octubre por $30.000. ¡Gracias!"*
- **Marcar incobrable**: deja de contar como "esperado".
- **Probabilidad de cobro** (100 / 50 / 0 %), que ajusta el "Esperado" del Inicio.

---

## 8. Sueldo (Embudo) — Negocio

```
┌────────────────────────────────────┐
│ SUELDO DE NOVIEMBRE                │
│ La empresa le debe a la familia    │
│            $ 250.000               │
├────────────────────────────────────┤
│ CÓMO SE REPARTE CADA COBRO  (≡ ordenar)
│ 1 ≡ ⛽ Nafta y peajes  150/150 ✔   │
│ 2 ≡ 💰 Sueldo mínimo   350/600 ▓▓░ │
│ 3 ≡ 🚙 Plan Hilux        0/400 ░░░ │
│ 4 ≡ 💰 Sueldo completo   0/500 ░░░ │
│ 5 ≡ 🧾 Impuestos         0/200 ░░░ │
│ [+ Agregar paso]                   │
├────────────────────────────────────┤
│ Para pasar a Familia: $50.000      │
│ [ Ya lo pasé ✓ ]                   │
└────────────────────────────────────┘
```

- Se arrastra **≡** para cambiar prioridades. Esto responde a "no siempre podemos sacarlo todo": lo urgente va arriba del sueldo completo.
- **Ya lo pasé ✓** registra la transferencia real a la cuenta familiar (en efectivo o en el banco).
- La plata asignada al sueldo queda **bloqueada para el negocio** desde el momento del cobro.

---

## 9. Sobres (Familia y Negocio)

- Lista agrupada (*Hijos · Casa · Auto · Metas*). Cada sobre muestra **lo disponible en grande** y una barra de lo usado este mes.
- Al tocar un sobre: **Agregar plata**, **Mover a otro sobre** y su historial.
- **Repartir** abre un asistente que llena los sobres por prioridad con la plata sin destino: primero 🍼 Bebé, 🏠 Casa y 🛒 Súper; después el pago mínimo de deudas; después 🛟 Emergencia; después deuda extra; y por último ahorro.
- Un sobre en **rojo** significa que se gastó más de lo que tenía, y la app propone de qué sobre cubrirlo.

---

## 10. Debemos (Familia; las del negocio en Más)

```
┌────────────────────────────────────┐
│ DEBEMOS  $ 36.500.000              │
│ Estrategia: (•) Avalancha ( ) Bola │
│  ⓘ Avalancha: primero la de mayor  │
│    interés. Bola de nieve: primero │
│    la más chica, para motivarse.   │
├────────────────────────────────────┤
│ 1 💳 Saldo viejo Visa  $900.000    │
│     120% anual · ~$90.000/mes de   │
│     intereses  ← ATACAR ESTA       │
│ 2 🚙 Plan Hilux  89 cuotas restan  │
├────────────────────────────────────┤
│ Si ponés $50.000 extra por mes:    │
│ Visa saldada en 9 meses (vs 18)    │
│ Ahorrás $410.000 de intereses      │
└────────────────────────────────────┘
```

---

## 11. Tarjetas

```
VISA — cierra el 28, vence el 10
Resumen actual       $ 425.000
  🐴 Negocio paga    $ 400.000   [Pagar desde Banco Negocio]
  🏠 Familia paga    $  25.000   [Pagar desde Billetera Familiar]
Cuotas en curso: Plan Hilux (31/120), Materiales cabañas (2/6)
```

Cada modo muestra solo su parte. La pantalla de arriba, con las dos partes, se ve únicamente desde **Más → Tarjetas**.

---

## 12. Sin señal

| Situación | Qué ve el usuario |
|---|---|
| Sin conexión | Una franja gris arriba: "Sin señal: lo que cargues se guarda en el teléfono". Todo funciona. |
| Vuelve la señal | ⟳ gira y el contador baja a 0. |
| El servidor rechaza algo | Una notificación lo envía a **Para revisar**, con el motivo en lenguaje simple y la opción de corregir o descartar. |
| Cotización vieja | "Dólar del 08/11 (sin señal)": se usa igual y se puede editar. |

---

## 13. Configuración inicial guiada (`/bienvenida`)

1. **Sus negocios**: Pensionado, Alimento y Cabañas (con la fecha de inauguración).
2. **Sus cuentas**: bancos, efectivo, Mercado Pago, dólares y tarjetas, indicando si cada tarjeta es compartida.
3. **Lo que deben**: tarjetas, Plan Hilux y compras en cuotas.
4. **Sus clientes del pensionado**: nombre, caballos, cuota y día de pago.
5. **¿Cuánto necesita la familia por mes?** → la app propone una cascada de sueldo inicial: costos urgentes, sueldo mínimo, cuotas, sueldo completo e impuestos.
6. **Saldos de hoy** → la app crea la plata sin destino y propone un primer reparto.

---

## 14. Componentes para la Fase 3

| Componente | Uso |
|---|---|
| `<SelectorAmbito />` | Interruptor global (Zustand + cambio de tema) |
| `<TarjetaResumen />` | Tarjetas del Inicio (cobrado/esperado, sueldo, me deben) |
| `<AlertaPrincipal />` | Alerta única según la prioridad de la sección 4 |
| `<BarraProgreso />` | Sobres, embudo, metas |
| `<CascadaEmbudo />` | Lista ordenable de reglas con su llenado |
| `<CargaRapida />` | Hoja inferior con teclado numérico |
| `<IndicadorSync />` | Estado de la cola sin conexión |
