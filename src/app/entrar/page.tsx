"use client";
import { useState, type FormEvent } from "react";
import { enviarEnlaceAcceso, verDemo, verificarCodigo } from "@/lib/estado/sesion";
import { Boton, Tarjeta } from "@/components/ui";
import { Campo, Mensaje } from "@/components/formulario";

export default function Entrar() {
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await enviarEnlaceAcceso(email.trim());
      setEnviado(true);
      setAviso({ tipo: "ok", texto: `Te mandamos un mail a ${email.trim()}. Escribí el código que llega, o tocá el enlace.` });
    } catch (err) {
      setAviso({ tipo: "error", texto: (err as Error).message });
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await verificarCodigo(email.trim(), codigo);
      // La sesión queda guardada; el arranque de la app redirige solo.
    } catch (err) {
      setAviso({ tipo: "error", texto: (err as Error).message });
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="pt-6 text-center">
        <p className="text-4xl" aria-hidden>🐴🏠</p>
        <h1 className="mt-2 text-2xl font-bold">Familianzas</h1>
        <p className="text-suave">Negocio y familia, cada peso en su lugar.</p>
      </div>
      <Tarjeta titulo="Entrar">
        {!enviado ? (
          <form onSubmit={enviar} className="space-y-3">
            <Campo etiqueta="Tu email" ayuda="Sin contraseña: te llega un código para entrar.">
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="campo" />
            </Campo>
            <Boton type="submit" className="w-full" disabled={ocupado || !email}>Enviarme el código</Boton>
          </form>
        ) : (
          <form onSubmit={confirmar} className="space-y-3">
            <Campo etiqueta="Código del mail">
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} className="campo cifra text-center text-2xl tracking-[0.4em]" />
            </Campo>
            <Boton type="submit" className="w-full" disabled={ocupado || codigo.length < 6}>Entrar</Boton>
            <Boton variante="fantasma" className="w-full" onClick={() => { setEnviado(false); setCodigo(""); setAviso(null); }}>
              Cambiar email o pedir otro código
            </Boton>
          </form>
        )}
        <div className="mt-3"><Mensaje aviso={aviso} /></div>
      </Tarjeta>
      <Boton variante="fantasma" className="w-full" onClick={() => void verDemo()}>Ver una demostración con datos de ejemplo</Boton>
    </div>
  );
}
