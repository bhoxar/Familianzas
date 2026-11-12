"use client";
/** Dólar: cotización del día (blue promedio, criterio dolarhoy.com) y venta de dólares. */
import { useState } from "react";
import { useAmbito } from "@/lib/estado/ambito";
import { useHoy, useInstantanea } from "@/lib/estado/datos";
import { db } from "@/lib/offline/db";
import { convertirDolares, guardarCotizacion, obtenerDolarBlue } from "@/lib/offline/operaciones";
import { cotizacionVigente, saldoCuenta } from "@/lib/dominio/calculos";
import { dolares, pesos, usdAPesos, vivos } from "@/lib/dominio/utiles";
import { Boton, Tarjeta } from "@/components/ui";
import { Campo, EntradaMonto, leerMonto, Mensaje } from "@/components/formulario";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

export default function Dolar() {
  const { ambito } = useAmbito();
  const s = useInstantanea();
  const fecha = useHoy();
  const [compra, setCompra] = useState("");
  const [venta, setVenta] = useState("");
  const [aviso, setAviso] = useState<Aviso>(null);
  const [usd, setUsd] = useState("");
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  if (!s) return null;

  const cot = cotizacionVigente(s, fecha);
  const cuentasUsd = vivos(s.cuentas).filter((c) => c.ambito === ambito && c.moneda === "USD" && !c.archivada);
  const cuentasArs = vivos(s.cuentas).filter((c) => c.ambito === ambito && c.moneda === "ARS" && c.tipo !== "tarjeta_credito" && !c.archivada);
  const o = origen || cuentasUsd[0]?.id;
  const d = destino || cuentasArs[0]?.id;
  const montoUsd = leerMonto(usd);

  const actualizar = async () => {
    const r = await obtenerDolarBlue();
    if (!r) return setAviso({ tipo: "error", texto: "No se pudo obtener la cotización (¿sin señal?). Cargala a mano." });
    await guardarCotizacion(db(), s, { ...r, fecha, fuente: "automatica" });
    setAviso({ tipo: "ok", texto: `Blue: compra ${pesos(r.compra * 100)} · venta ${pesos(r.venta * 100)}` });
  };
  const manual = async () => {
    try {
      await guardarCotizacion(db(), s, { compra: leerMonto(compra) / 100, venta: leerMonto(venta) / 100, fecha, fuente: "manual" });
      setCompra(""); setVenta("");
      setAviso({ tipo: "ok", texto: "Cotización guardada." });
    } catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); }
  };
  const convertir = async () => {
    try {
      const r = await convertirDolares(db(), s, { cuentaUsdId: o!, cuentaPesosId: d!, usd: montoUsd, cotizacion: cot!.promedio });
      setUsd("");
      setAviso({ tipo: "ok", texto: `Entraron ${pesos(r.pesosRecibidos)}.${r.embudo?.pasos.length ? ` Se repartieron con el Embudo.` : ""}` });
    } catch (e) { setAviso({ tipo: "error", texto: (e as Error).message }); }
  };

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Dólar</h1>
      <Mensaje aviso={aviso} />
      <Tarjeta titulo="Cotización (blue, promedio)">
        {cot ? (
          <>
            <p className="cifra text-3xl font-bold">{pesos(cot.promedio * 100)}</p>
            <p className="text-sm text-suave">
              Compra {pesos(cot.compra * 100)} · Venta {pesos(cot.venta * 100)} · {cot.fecha.split("-").reverse().join("/")} · {cot.fuente === "manual" ? "cargada a mano" : "automática"}
              {cot.fecha !== fecha && " (no es de hoy)"}
            </p>
          </>
        ) : <p className="text-sm text-suave">Todavía no hay cotización.</p>}
        <Boton variante="secundario" className="mt-3 w-full" onClick={actualizar}>Actualizar ahora</Boton>
        <details className="mt-3">
          <summary className="text-sm text-suave">Cargar a mano (ej: lo que dice dolarhoy.com)</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Campo etiqueta="Compra"><EntradaMonto valor={compra} onChange={setCompra} /></Campo>
            <Campo etiqueta="Venta"><EntradaMonto valor={venta} onChange={setVenta} /></Campo>
          </div>
          <Boton className="mt-2 w-full" disabled={!leerMonto(compra) || !leerMonto(venta)} onClick={manual}>Guardar</Boton>
        </details>
      </Tarjeta>

      <Tarjeta titulo="Vender dólares">
        {cuentasUsd.length === 0 ? <p className="text-sm text-suave">No hay cuentas en dólares en este ámbito.</p> : (
          <div className="space-y-3">
            <Campo etiqueta="Desde">
              <select value={o} onChange={(e) => setOrigen(e.target.value)} className="campo">
                {cuentasUsd.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {dolares(saldoCuenta(c, s.transacciones))}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Dólares"><EntradaMonto valor={usd} onChange={setUsd} placeholder="US$ 0" /></Campo>
            <Campo etiqueta="Los pesos entran a">
              <select value={d} onChange={(e) => setDestino(e.target.value)} className="campo">
                {cuentasArs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            {cot && montoUsd > 0 && <p className="text-sm">Recibís <b className="cifra">{pesos(usdAPesos(montoUsd, cot.promedio))}</b> al promedio {pesos(cot.promedio * 100)}.</p>}
            <Boton className="w-full" disabled={!cot || !montoUsd || !d} onClick={convertir}>Vender</Boton>
            {ambito === "empresa" && <p className="text-xs text-suave">Los pesos del negocio se reparten con el Embudo, como cualquier cobro.</p>}
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
