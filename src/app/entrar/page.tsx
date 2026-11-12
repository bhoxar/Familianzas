"use client";
import { useState, type FormEvent } from "react";
import { enviarEnlaceAcceso, verDemo } from "@/lib/estado/sesion";
import { Boton, Tarjeta } from "@/components/ui";
import { Campo, Mensaje } from "@/components/formulario";

export default function Entrar() {
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    try {
      await enviarEnlaceAcceso(email.trim());
      setAviso({ tipo: "ok", texto: `Te mandamos un enlace a ${email}. Abrilo desde este teléfono para entrar.` });
    } catch (err) {
      setAviso({ tipo: "error", texto: (err as Error).message });
    } finally {
      setEnviando(false);
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
        <form onSubmit={enviar} className="space-y-3">
          <Campo etiqueta="Tu email" ayuda="Sin contraseña: te llega un enlace para entrar.">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="campo" />
          </Campo>
          <Boton type="submit" className="w-full" disabled={enviando || !email}>Enviarme el enlace</Boton>
          <Mensaje aviso={aviso} />
        </form>
      </Tarjeta>
      <Boton variante="fantasma" className="w-full" onClick={() => void verDemo()}>Ver una demostración con datos de ejemplo</Boton>
    </div>
  );
}
