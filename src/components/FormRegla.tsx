"use client";
/** Alta / edición de un paso de la cascada del sueldo. */
import { useState } from "react";
import { db } from "@/lib/offline/db";
import { eliminarEntidad, guardarEntidad } from "@/lib/offline/operaciones";
import type { Instantanea } from "@/lib/dominio/calculos";
import type { DestinoRegla, ReglaEmbudo } from "@/lib/dominio/tipos";
import { vivos } from "@/lib/dominio/utiles";
import { Boton } from "./ui";
import { Campo, EntradaMonto, Interruptor, leerMonto, Mensaje } from "./formulario";

export function FormRegla({ s, inicial, onListo }: { s: Instantanea; inicial: Partial<ReglaEmbudo>; onListo: () => void }) {
  const [d, setD] = useState({ ...inicial, topeTxt: inicial.tope_mensual ? String(inicial.tope_mensual / 100) : "" });
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const sobres = vivos(s.sobres).filter((o) => o.ambito === "empresa" && o.tipo !== "sueldo");
  const unidades = vivos(s.unidades);

  const guardar = async () => {
    const tope = leerMonto(d.topeTxt);
    if (!d.nombre?.trim() || tope <= 0) return setAviso({ tipo: "error", texto: "Completá nombre y tope mensual" });
    if (d.destino === "sobre" && !d.sobre_id) return setAviso({ tipo: "error", texto: "Elegí el sobre que llena este paso" });
    if (d.destino === "sueldo" && !s.config?.sobre_sueldo_id) return setAviso({ tipo: "error", texto: "Falta el sobre 'Sueldo por transferir'" });
    const { topeTxt, ...resto } = d;
    void topeTxt;
    const orden = d.orden ?? Math.max(0, ...vivos(s.reglas).map((r) => r.orden)) + 1;
    await guardarEntidad(db(), s, "reglas_embudo", {
      ...resto, nombre: d.nombre.trim(), tope_mensual: tope, orden, activa: d.activa ?? true,
      sobre_id: d.destino === "sueldo" ? s.config!.sobre_sueldo_id : d.sobre_id,
      porcentaje_max: d.porcentaje_max || null,
    });
    onListo();
  };

  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre"><input value={d.nombre ?? ""} onChange={(e) => setD({ ...d, nombre: e.target.value })} placeholder="Ej: Reponer alimento" className="campo" /></Campo>
      <Campo etiqueta="¿A dónde va la plata?">
        <select value={d.destino} onChange={(e) => setD({ ...d, destino: e.target.value as DestinoRegla })} className="campo">
          <option value="sobre">A un sobre del negocio</option>
          <option value="sueldo">💰 Al sueldo de la familia</option>
        </select>
      </Campo>
      {d.destino === "sobre" && (
        <Campo etiqueta="Sobre">
          <select value={d.sobre_id ?? ""} onChange={(e) => setD({ ...d, sobre_id: e.target.value })} className="campo">
            <option value="">Elegí…</option>
            {sobres.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Campo>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Tope por mes"><EntradaMonto valor={d.topeTxt} onChange={(v) => setD({ ...d, topeTxt: v })} /></Campo>
        <Campo etiqueta="Máx. % de cada cobro" ayuda="Opcional">
          <input inputMode="numeric" value={d.porcentaje_max ?? ""} onChange={(e) => setD({ ...d, porcentaje_max: e.target.value ? Math.min(100, Number(e.target.value)) : null })} className="campo" />
        </Campo>
      </div>
      <Campo etiqueta="Solo cobros de">
        <select value={d.unidad_negocio_id ?? ""} onChange={(e) => setD({ ...d, unidad_negocio_id: e.target.value || null })} className="campo">
          <option value="">Todos los negocios</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </Campo>
      <Interruptor etiqueta="Paso activo" activo={d.activa ?? true} onChange={(v) => setD({ ...d, activa: v })} />
      <Mensaje aviso={aviso} />
      <Boton className="w-full" onClick={guardar}>Guardar</Boton>
      {inicial.id && (
        <Boton variante="fantasma" className="w-full text-rojo" onClick={async () => {
          if (confirm("¿Borrar este paso?")) { await eliminarEntidad(db(), "reglas_embudo", inicial as ReglaEmbudo); onListo(); }
        }}>Borrar paso</Boton>
      )}
    </div>
  );
}
