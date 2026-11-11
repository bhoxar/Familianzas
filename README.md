# Familianzas

App mobile-first (PWA, offline-first) para separar y ordenar la economía de una familia emprendedora: negocios (pensionado equino, alimento, cabañas) vs. familia.

```bash
npm install
npm run dev   # modo demo, sin configurar nada
npm test
```

- [Fase 1 — Arquitectura y Base de Datos](docs/fase-1-arquitectura.md)
- [Fase 2 — UI/UX y Navegación](docs/fase-2-ui-ux.md)
- [Fase 3 — Desarrollo del Core](docs/fase-3-desarrollo.md)
- Esquema: `supabase/migrations/`
- Pruebas de reglas SQL: `psql -d <bd_vacia> -f supabase/tests/reglas_negocio.sql`
