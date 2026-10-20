# Historia verificable de AoA para DevDay Concepción

Investigación read-only del repo + Pacifico, 15 octubre 2026. No confundir los modelos/números históricos con comportamiento actual.

## Por qué y para qué (voz del usuario, no motivación inventada)

Pacifico sesión `0c9b094b-0126-42f3-88fe-5387a21b8b2d`, `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-aoa/0c9b094b-0126-42f3-88fe-5387a21b8b2d.jsonl`, mensajes 6–17:
- Quería un RTS jugado por agentes LLM conectados por MCP o CLI, en loop continuo. «no importa que tan ingeligente sea el llm si no que tambien que tan rapido sea».
- Unidades programables: «tipo los bots o juegos de bots antiguos, recuerdo uno que hice en la u donde programabamos un bot en java». Se puede usar como motivación personal sin inventar infancia ni nostalgia por AoE.
- Usuario propone engine agnóstico y solo API; cualquiera construye su conector/canal. El agente construye y juega.
- Encargo de implementación: «no pares hasta tener el mvp listo… cliente isometrico… isometrica dithering, pixelart, se creativo go ahead. nos vemos en la mañana».
- Hubo diseño previo en claude.ai: transcript de búsqueda histórica refiere chat «Género de Age of Empires», 20 marzo 2026. Es evidencia secundaria dentro de sesión, no leí ese export original ahora; NO afirmar fecha exacta de comienzo como verificada.

Pacifico sesión `95af863a-78eb-45cf-86e9-40c1a92ac002`, `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-aoa/95af863a-78eb-45cf-86e9-40c1a92ac002.jsonl`, mensaje 0:
- Conversación pegada con Alonso: meetup Concepción 20 octubre; 20–25 minutos; permite proyectos de competencia.
- Emerson: «encuentro que es bien educativo sobre como funciona un llm, un agente, un harness, mcp, etc».
- Humor ya original: «ahora iteraré unos nombres con claude / digo, codex».
- Mensaje 6 propuesta propia: «Por y para agentes: Construyendo un RTS con Codex y Claude».

## Tres historias concretas

### 1. La primera partida duró 84 segundos
Pacifico 0c9b094b mensajes 40–54. Resultado corroborado ahora en `.wt-old/packages/web/public/featured/25fe89ae.json`: 839 ticks/10Hz=83.9 s; gana p2 codex por vital_lost. Codex envió 7 órdenes de torreta, Claude 3 muros. Towers tenían más rango que Nexus y construcciones eran instantáneas; llevó a añadir exclusión de construcción de 8 casillas. GDD histórico docs/gdd.md:77 explica el incidente. Esto ilustra que un agente encuentra incentivos/reglas no anticipados. La regla actual NO conserva esa exclusión: packages/shared/src/rules.ts:20 `buildExclusion:0`, con construcción temporizada. Decir «tuve que cambiar las reglas» históricamente, no vender exclusión como actual.

### 2. Ganó el script mientras el agente pensaba
Pacifico 0c9b094b mensajes 75–78 aprox (leer bloque 40–95 completo para localizar). `.wt-old/packages/web/public/featured/d8278467.json` corroborado: 1228 ticks=122.8s; Astra low gana p2; 6 ticks de decisiones distintos vs 14 rival. Script ranger con kiting, 19 órdenes train. Rival Opus low tuvo 15 train, 6 ataques, 2 torretas. Transcript dice 9 rangers vs knights; se puede mostrar código real desde replay. Lección sugerida: delegar reflejos a código permite al LLM decidir estrategia a otro ritmo. Esta partida todavía permitió scripts en preparación, regla que usuario corrigió después. Evitar comparativa científica de modelos basada en ella.

### 3. Creí que comparaba modelos, estaba comparando sistemas
Pacifico 0c9b094b mensajes 63–64 aprox: Opus high consultó advisor heredado, ~70s sin órdenes, y dejó memoria para futuras partidas. `.wt-old/packages/web/public/featured/41b589fe.json` confirma medium gana a 158.3s, aunque score high 1540 > 790; 22 momentos de decisiones vs 17. El uso de advisor/70s está en el informe histórico del asistente, no inferible solo del replay. Cambiaron aislamiento/settings. Lección: modelo + prompt + herramientas + memoria + loop + latencia = sistema observado. No demuestra medium superior a high.

## Cómo funciona hoy, verificado en código

- Reglas actuales 0.27.0, 10 min 1v1/15 min cuatro jugadores, preparación 60s: packages/shared/src/rules.ts:11–28; tickRate 10 aparece README:3 y grabaciones.
- Solo King vital; castillo produce/recibe recursos y es destruible sin eliminación automática: rules.ts:95–136.
- Unidades programables JS, scripts en QuickJS WASM sin acceso host, presupuesto determinista de ciclos: packages/sandbox/src/index.ts:1–8 y rules.ts:179.
- El LLM nunca es parte del tick; API HTTP, conectores CLI/MCP y loop keepers; servidor desconoce conectores: docs/architecture.md:17–27. Ojo arquitectura.md conserva datos viejos en algunas tablas; usar README y reglas generadas para detalles.
- Estado del jugador incluye ASCII, unidades visibles, ataques/eventos, memoria lastSeen: packages/engine/src/match.ts:467–515; enemigo visible solo canSee.
- Replay vuelve a simular órdenes con reglas y seed, verifica hashes: packages/engine/src/replay.ts:19–41. Hero usa estados precalculados, no ejecuta scripts: packages/web/src/showcaseRecording.ts:4–6.
- Renderer real Pixi isométrico y dither, setFrame + interpolación: packages/web/src/render/renderer.ts:1–7,180–225,452.
- Primer commit git 0f2cb93, 27 sept: motor/server/connectors/replay. Esto no es fecha inicial de la idea ni duración total de trabajo.

## Arte y pipeline

- Sprites originales generados: assets/raw/v1/*.png; giro en sheets assets/raw/{king,knight,ranger,worker}_sheet.png; edificios assets/raw/buildings.png.
- Pacifico generación Codex `01a0e0e8-bec4-76b1-992f-fe698bcfd11e`, `/Users/emersoftware/.codex/sessions/2026/09/27/rollout-2026-09-27T00-29-04-01a0e0e8-bec4-76b1-992f-fe698bcfd11e.jsonl`, búsqueda dice sprite agent con imagegen, especificaciones 3/4 RTS. No leí mensaje completo; pipeline actual sí fuente primaria abajo.
- assets/animations/README.md:5–14: 5 vistas generadas y 3 espejadas, 28 frames a 12fps; 4 tipos de unidad.
- README:38–53: MiniMax H3 Turbo LoRA, reference + generated.mp4 + request.json preservados; loops misma imagen al inicio/final; caminar regenera desde mid-step; elimina magenta y empaqueta atlas grises.
- README:64–75: normalización contraste atlas entero, tint equipo + dithering; ataques se sincronizan con golpe del motor, no inventan daños nuevos.
- Galerías locales assets/animations/*/*-directions/index.html con previews; rejected-* conserva intentos rechazados, una historia visual de iteración.

## Media lista

- `videos/aoa-promo-horizontal-v2.mp4`: 35.2MB, ffprobe 47.200s. `videos/aoa-promo-horizontal.mp4`: 35.6MB. `videos/aoa-promo-reel-v7.mp4`: 36.1MB. Son renders locales existentes, no necesitan nueva generación.
- Fuente real Aktura: packages/web/public/fonts/aktura.woff2.
- Assets runtime optimizados: packages/web/public/game-assets/hero-sprites completo 2.6MB; full sprites 8MB; fuentes PNG originals 17MB.
- Partidas antiguas primeras NO en replays actual, sí en `.wt-old/packages/web/public/featured/{25fe89ae,3b0d3b84,41b589fe,d8278467,555593be}.json`.

## Motor real dentro del HTML

Es viable sin servidor de juego ni API: bundle GameRenderer (Pixi), frames precalculados y sprites relativos, servido por HTTP estático local.
- `GameRenderer.create(host,ruleset,colors,{fitOnResize:true,interactive:false,spriteBase:'./assets/sprites'})`
- `renderer.setFrame(frame,100)`, `renderer.setPaused(true/false)`, `renderer.focus(box)`; jump `setFrame(frame,100,true)` al reset.
- Fuente precalculada `packages/web/public/showcase/02eb6795/manifest.json` y chunks gz. NO confundir con raíz `/showcase/02eb6795.json` que es replay completo.
- `decodeShowcaseChunk` en showcaseRecording.ts aplica deltas. Build puede extraer 200 frames a JSON sin gzip para offline.
- Extracto recomendado ticks 1743–1942 (174.3–194.2s, 20s): 10 muertes, 216 ataques. Cámara x0 .5,y0 8,x1 12.5,y1 22 para el frente izquierdo; validar visualmente.
- Chunks necesarios `1543-d32e7ee021b5ccea.json.gz` y `1843-fea2647c419c871e.json.gz`.
- Jugadores exactos showcase: p1 Opus 5.5 side2; p2 Sol 6.1 side0; p3 Fable 5.1 side1; p4 Astra 6 side3.
- Los frames showcase son board-only y NO incluyen perspectivas. Para la versión final de la charla se re-simuló el replay original con `extract-pov.mts` hasta tick 1743, comprobando 18 hashes. Se guardó `assets/pov-frame.json` y se capturaron las vistas reales de observador y p1. La reproducción del extracto mantiene vista de observador; la comparación de perspectivas está en la slide 6.

## Memoria consultada para descubrir rutas, luego contrastada

MEMORY.md:1784–1814 sobre diversidad RTS y memoria de primeras partidas. MEMORY.md:3368–3409 sobre fiabilidad y experimentos. No usar estadísticas proyectiles como causalidad pura: agentes cambiaron scripts. IDs 01a0e3bf-80b4-7142-a7fa-0b6d34a59fbc y 01a11832-0ac5-75e3-9f9b-2b6796846417.
