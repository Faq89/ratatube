# Ratatube — Hybrid Media Hub 🎬✨

Plataforma multimedia híbrida y multiusuario basada en el ecosistema **Stremio**, con interfaz moderna estilo **Netflix / Max**, clasificación avanzada de idiomas con prioridad en **Español Latino (es-419)**, motor de subtítulos con corrección de sincronización progresiva en tiempo real y arquitectura de almacenamiento volátil (**cero archivos permanentes en disco local**).

Despliegue en producción: [https://ratatube.vercel.app](https://ratatube.vercel.app)

---

## 🌟 Características Principales

1. **Diseño Cinematográfico Estilo Netflix / Max**:
   * Paleta oscura con acentos verde esmeralda suaves para descanso visual nocturno.
   * Navbar fija con cristal translúcido (`backdrop-blur-md`).
   * Hero Billboard panorámico con metadatos técnicos, sinopsis y botón de reproducción directa.
   * Carruseles horizontales desplazables (*Películas*, *Series*, *Anime*, *Continuar Viendo*, *Mi Lista*).
   * Tarjetas 2:3 con animación de escala (`scale-105`), badge IMDb y superposición de reproducción.

2. **Ecosistema Stremio Universal & Addons**:
   * Catálogo de películas y series mediante Cinemeta.
   * Catálogo de anime y animación mediante Anime Kitsu.
   * Compatibilidad nativa con addons comunitarios de Stremio a través de URL de manifiesto (`manifest.json` y protocolo `stremio://`).
   * Múltiples servidores HTTPS en la nube para reproducción directa en el navegador.

3. **Prioridad Inteligente de Idioma (Español Latino es-419)**:
   * 1º Español Latino (`es-419` / `spa-latam`)
   * 2º Castellano (`es-ES`)
   * 3º Idioma Original con subtítulos en Español
   * Clasificador lingüístico riguroso basado en metadatos reales sin inventar pistas.

4. **Motor Avanzado de Subtítulos**:
   * Compatibilidad con formatos `.srt`, `.vtt`, `.ass` y `.ssa`.
   * Integración directa con OpenSubtitles v3 (Oficial Stremio).
   * Carga de archivos externos desde el navegador.
   * Ajuste de desfase manual en tiempo real (±100ms, ±250ms, ±500ms).
   * Compensación de deriva por disparidad de fotogramas por segundo (23.976 fps ↔ 24.000 fps ↔ 25.000 fps).
   * Sincronización progresiva de dos puntos (anclaje de inicio y final).
   * Selector rápido de frase para saltar directamente al diálogo escuchado.

5. **Multiusuario & Modo Invitado Estricto**:
   * Cuentas familiares con múltiples perfiles personalizados.
   * Control parental infantil con filtrado automático de contenidos clasificados para adultos.
   * Persistencia por perfil de listas, favoritos y progreso de reproducción.
   * **Modo Invitado 100% libre de rastro**: no almacena historial, progreso ni datos personales.

6. **Arquitectura Efímera y Agente Local**:
   * Cero bases de datos locales: integración con **Supabase PostgreSQL Cloud**.
   * Agente local opcional para remultiplexado FFmpeg al vuelo y descargas temporales.
   * Todo buffer temporal vive exclusivamente en `os.tmpdir()` con cuota controlada y purga periódica.

---

## 🏗️ Arquitectura del Monorepo

```
ratatube/
├── apps/
│   ├── web/               # Frontend Next.js 14 App Router + Tailwind CSS
│   └── local-agent/       # Agente local de remuxing FFmpeg y caché volátil
├── packages/
│   ├── addon-sdk/         # Cliente del ecosistema de addons Stremio
│   ├── database/          # Cliente Supabase PostgreSQL con tipado TypeScript
│   ├── shared/            # Modelos compartidos, tipos y clasificador lingüístico
│   └── subtitle-engine/   # Parser y motor de sincronización matemática de subtítulos
├── scripts/
│   └── run-tests.mjs      # Ejecutor unificado de la suite de pruebas
└── supabase/
    └── migrations/        # Esquema SQL y políticas de seguridad RLS
```

---

## 🚀 Instalación y Desarrollo Local

### Requisitos
* Node.js >= 18.17.0
* npm >= 9.0.0

### Pasos
```bash
# 1. Clonar el repositorio
git clone https://github.com/Faq89/ratatube.git
cd ratatube

# 2. Instalar dependencias del monorepo
npm install

# 3. Iniciar el entorno de desarrollo
npm run dev

# La aplicación web estará disponible en http://localhost:3000
```

---

## 🧪 Pruebas Unitarias y de Integración

El proyecto cuenta con una suite integral que valida el 100% de los requisitos:
```bash
npm test
```

---

## ☁️ Despliegue en Vercel

El repositorio está sincronizado con Vercel para despliegues continuos (CI/CD):
* **Rama de producción**: `main`
* Cada `push` a la rama `main` compila y despliega automáticamente la nueva versión en producción.
