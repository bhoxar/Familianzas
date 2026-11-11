"use client";
/**
 * Estado global del interruptor Negocio / Familia.
 * Se recuerda en el teléfono (localStorage) y, con sesión, en usuarios.modo_preferido.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Ambito } from "../dominio/tipos";

interface EstadoAmbito {
  ambito: Ambito;
  /** Filtro por unidad de negocio (solo modo Negocio). null = todas. */
  unidadId: string | null;
  cambiarAmbito: (a: Ambito) => void;
  alternar: () => void;
  filtrarUnidad: (id: string | null) => void;
}

export const useAmbito = create<EstadoAmbito>()(
  persist(
    (set, get) => ({
      ambito: "familia",
      unidadId: null,
      cambiarAmbito: (ambito) => set({ ambito, unidadId: null }),
      alternar: () => set({ ambito: get().ambito === "empresa" ? "familia" : "empresa", unidadId: null }),
      filtrarUnidad: (unidadId) => set({ unidadId }),
    }),
    { name: "familianzas-ambito" },
  ),
);
