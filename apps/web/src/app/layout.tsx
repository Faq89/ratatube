import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ratatube — Hybrid Media Hub (Stremio + Cloud + Agente Local)',
  description:
    'Plataforma multimedia híbrida y multiusuario basada en el ecosistema Stremio, con prioridad en Español Latino, motor avanzado de subtítulos y caché local efímero.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#090b10] text-gray-100 antialiased selection:bg-emerald-500 selection:text-black">
        {children}
      </body>
    </html>
  );
}

