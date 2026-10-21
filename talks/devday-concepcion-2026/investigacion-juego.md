# Historia verificable de AoA para DevDay Concepción

Investigación read-only del repo y Pacifico, 15 octubre 2026. Los modelos y números históricos no son el comportamiento actual.

## Por qué y para qué (voz del usuario, no motivación inventada)

Pacifico sesión `0c9b094b-0126-42f3-88fe-5387a21b8b2d`, `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-aoa/0c9b094b-0126-42f3-88fe-5387a21b8b2d.jsonl`, mensajes 6–17:
- RTS para agentes LLM por MCP o CLI, en loop continuo. «no importa que tan ingeligente sea el llm si no que tambien que tan rapido sea».
- Unidades programables: «tipo los bots o juegos de bots antiguos, recuerdo uno que hice en la u donde programabamos un bot en java». Sirve como motivación personal, sin inventar infancia ni nostalgia por AoE.
- El usuario propone engine agnóstico, solo API: cada quien construye su conector. El agente construye y juega.
- Encargo de implementación: «no pares hasta tener el mvp listo… cliente isometrico… isometrica dithering, pixelart, se creativo go ahead. nos vemos en la mañana».
- Hubo diseño previo en claude.ai: un transcript histórico menciona el chat «Género de Age of Empires», 20 marzo 2026. Es evidencia secundaria; no leí ese export. NO des por verificada la fecha de inicio.

Pacifico sesión `95af863a-78eb-45cf-86e9-40c1a92ac002`, `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-aoa/95af863a-78eb-45cf-86e9-40c1a92ac002.jsonl`, mensaje 0:
- Conversación pegada con Alonso: meetup Concepción, 20 octubre, 20–25 minutos, acepta proyectos de competencia.
- Emerson: «encuentro que es bien educativo sobre como funciona un llm, un agente, un harness, mcp, etc».
- Humor ya original: «ahora iteraré unos nombres con claude / digo, codex».
- Mensaje 6: «Por y para agentes: Construyendo un RTS con Codex y Claude».

## Tres historias concretas

### 1. La primera partida duró 84 segundos
Pacifico 0c9b094b mensajes 40–54. Lo corrobora `.wt-old/packages/web/public/featured/25fe89ae.json`: 839 ticks/10Hz = 83.9 s; gana p2 codex por vital_lost. Codex: 7 órdenes de torreta; Claude: 3 muros.

Las torres tenían más rango que el Nexus y construir era instantáneo. Llegó una exclusión de construcción de 8 casillas (GDD histórico docs/gdd.md:77). Un agente encuentra incentivos y reglas no previstos.

Hoy NO existe esa exclusión: packages/shared/src/rules.ts:20 `buildExclusion:0`, con construcción temporizada. Cuenta «tuve que cambiar las reglas» como historia.

### 2. Ganó el script mientras el agente pensaba
Pacifico 0c9b094b mensajes 75–78 aprox (lee el bloque 40–95 para ubicarlo). Lo corrobora `.wt-old/packages/web/public/featured/d8278467.json`: 1228 ticks = 122.8s. Gana p2 Astra low, con 6 ticks de decisiones distintos contra 14.

Script ranger con kiting y 19 órdenes train. El rival Opus low: 15 train, 6 ataques, 2 torretas. El transcript dice 9 rangers contra knights; el código real sale del replay.

Lección: el código maneja reflejos y el LLM decide estrategia a otro ritmo. Esta partida aún permitía scripts en preparación, regla que el usuario corrigió. No es comparativa científica de modelos.

### 3. Creí que comparaba modelos, estaba comparando sistemas
Pacifico 0c9b094b mensajes 63–64 aprox: Opus high consultó un advisor heredado, pasó ~70s sin órdenes y dejó memoria para futuras partidas.

`.wt-old/packages/web/public/featured/41b589fe.json`: medium gana a 158.3s, aunque el score de high es 1540 > 790, con 22 momentos de decisión contra 17. Advisor y 70s vienen del informe histórico, no del replay. Cambiaron aislamiento y settings.

Lección: modelo + prompt + herramientas + memoria + loop + latencia = sistema observado. No prueba que medium supere a high.

## Cómo funciona hoy, verificado en código

- Reglas 0.27.0: 10 min 1v1, 15 min con 4 jugadores, preparación 60s: packages/shared/src/rules.ts:11–28. tickRate 10 en README:3 y grabaciones.
- Solo el King es vital. El castillo produce y recibe recursos; es destruible sin eliminar al jugador: rules.ts:95–136.
- Unidades programables en JS; scripts en QuickJS WASM sin acceso al host, con presupuesto determinista de ciclos: packages/sandbox/src/index.ts:1–8 y rules.ts:179.
- El LLM nunca participa del tick: API HTTP, conectores CLI/MCP y loop keepers; el servidor no conoce los conectores (docs/architecture.md:17–27). Ojo: architecture.md tiene tablas viejas; para detalles usa README y reglas generadas.
- Estado del jugador: ASCII, unidades visibles, ataques/eventos, memoria lastSeen: packages/engine/src/match.ts:467–515. El enemigo aparece solo con canSee.
- El replay re-simula órdenes con reglas y seed, y verifica hashes: packages/engine/src/replay.ts:19–41. El hero usa estados precalculados, sin scripts: packages/web/src/showcaseRecording.ts:4–6.
- Renderer real Pixi isométrico con dither, setFrame e interpolación: packages/web/src/render/renderer.ts:1–7,180–225,452.
- Primer commit git 0f2cb93, 27 sept: motor/server/connectors/replay. No es el inicio de la idea ni la duración del trabajo.

## Arte y pipeline

- Sprites originales: assets/raw/v1/*.png; giro en assets/raw/{king,knight,ranger,worker}_sheet.png; edificios en assets/raw/buildings.png.
- Generación Codex, Pacifico `01a0e0e8-bec4-76b1-992f-fe698bcfd11e`, `/Users/emersoftware/.codex/sessions/2026/09/27/rollout-2026-09-27T00-29-04-01a0e0e8-bec4-76b1-992f-fe698bcfd11e.jsonl`. Según la búsqueda, un sprite agent usó imagegen con especificaciones de RTS 3/4. No leí el mensaje completo; el pipeline actual sí tiene fuente primaria abajo.
- assets/animations/README.md:5–14: 5 vistas generadas y 3 espejadas, 28 frames a 12fps, 4 tipos de unidad.
- README:38–53: MiniMax H3 Turbo LoRA; guarda reference, generated.mp4 y request.json. Loops con la misma imagen al inicio y final; caminar regenera desde mid-step; quita el magenta y empaqueta atlas grises.
- README:64–75: normaliza contraste del atlas entero, tint de equipo y dithering. Los ataques se sincronizan con el golpe del motor, sin daños nuevos.
- Galerías locales assets/animations/*/*-directions/index.html con previews; rejected-* guarda intentos rechazados, historia visual de la iteración.

## Media lista

- `videos/aoa-promo-horizontal-v2.mp4`: 35.2MB, ffprobe 47.200s. `videos/aoa-promo-horizontal.mp4`: 35.6MB. `videos/aoa-promo-reel-v7.mp4`: 36.1MB. Son renders locales existentes; no hay que regenerarlos.
- Fuente real Aktura: packages/web/public/fonts/aktura.woff2.
- Assets runtime optimizados, packages/web/public/game-assets: hero-sprites completo 2.6MB; sprites completos 8MB; PNG originales 17MB.
- Las primeras partidas NO están en replays actual, sino en `.wt-old/packages/web/public/featured/{25fe89ae,3b0d3b84,41b589fe,d8278467,555593be}.json`.

## Motor real dentro del HTML

Funciona sin servidor de juego ni API: bundle GameRenderer (Pixi), frames precalculados y sprites relativos, por HTTP estático local.
- `GameRenderer.create(host,ruleset,colors,{fitOnResize:true,interactive:false,spriteBase:'./assets/sprites'})`
- `renderer.setFrame(frame,100)`, `renderer.setPaused(true/false)`, `renderer.focus(box)`. Reset: `setFrame(frame,100,true)`.
- Fuente precalculada: `packages/web/public/showcase/02eb6795/manifest.json` y chunks gz. NO es `/showcase/02eb6795.json` en la raíz, el replay completo.
- `decodeShowcaseChunk` en showcaseRecording.ts aplica deltas. El build puede extraer 200 frames a JSON sin gzip, offline.
- Extracto recomendado: ticks 1743–1942 (174.3–194.2s, 20s): 10 muertes, 216 ataques. Cámara x0 .5,y0 8,x1 12.5,y1 22 para el frente izquierdo. Valídalo visualmente.
- Chunks necesarios: `1543-d32e7ee021b5ccea.json.gz` y `1843-fea2647c419c871e.json.gz`.
- Jugadores del showcase: p1 Opus 5.5 side2; p2 Sol 6.1 side0; p3 Fable 5.1 side1; p4 Astra 6 side3.
- Los frames del showcase traen solo el tablero, SIN perspectivas. Para la versión final re-simulé el replay original con `extract-pov.mts` hasta el tick 1743 y comprobé 18 hashes. Guardé `assets/pov-frame.json` y las vistas reales de observador y p1. El extracto va en vista de observador; la comparación de perspectivas está en la slide 6.

## Memoria consultada para descubrir rutas, luego contrastada

MEMORY.md:1784–1814: diversidad RTS y memoria de primeras partidas. MEMORY.md:3368–3409: fiabilidad y experimentos. Las estadísticas de proyectiles no son causalidad pura: los agentes cambiaron scripts. IDs 01a0e3bf-80b4-7142-a7fa-0b6d34a59fbc y 01a11832-0ac5-75e3-9f9b-2b6796846417.
