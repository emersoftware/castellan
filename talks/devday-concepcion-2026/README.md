# Charla Castellan · DevDay Exchange Community: Concepción

«Por y para agentes: construyendo un juego de estrategia con Codex y Claude» · martes 20 de octubre de 2026.

El deck tiene 30 escenas y 76 pasos. La meta es 23 minutos de contenido y 2 de margen o preguntas. Hoy `contenido-v2.json` suma 1400 s. Es la versión 3, KISS: sin rótulos, todo centrado y un solo dithering. Las versiones anteriores están en `versiones/` (v1, v2, v3-negro, v3b, v3c y v4-antes-de-paralelo).

## Abrir

En macOS, haz doble clic en `iniciar.command`. Levanta un servidor local (http://127.0.0.1:8018 o un puerto libre) y abre el navegador. Ctrl+C lo cierra.

A mano: corre `python3 servir.py` desde esta carpeta. Con `--no-open` no abre el navegador. Usa ese servidor y no `python3 -m http.server`: responde peticiones Range, que Chrome necesita para repetir videos y mover el audio.

Todo es local: fuentes, logos, audio, video y replays. No hay CDN ni llamadas a modelos. Ábrelo siempre con `iniciar.command` o `servir.py`: replays, atlas, datos y audio cargan con `fetch`, que el navegador bloquea en `file://`.

## Presentar

- → espacio Page Down: siguiente paso. ← Page Up: paso anterior. Cada escena tiene varios pasos (76 en total). Retroceder vuelve exactamente al estado anterior.
- Inicio/Fin: primera/última escena. Número + Enter: vas a esa escena (15 Enter → diplomacia).
- `F` pantalla completa · `B` o `.` pantalla negra · `W` o `,` pantalla blanca · `O` índice · `M` silencio · `R` repite la animación del paso · `V` video de respaldo (montaje local de partidas, por si WebGL falla en el proyector) · `?` ayuda.
- `P` abre la vista del presentador en otra ventana: escena y paso, clic actual y siguiente, guion, fuentes, reloj con ritmo y lista de escenas. Desde ahí también avanzas y retrocedes. Deja esa ventana en tu pantalla y la presentación en el proyector.
- Los enlaces directos sirven para ensayar: `index.html#diplomacy/2` abre la escena 15 en su tercer paso.
- El sonido empieza tras un clic o tecla en la ventana de la presentación; el navegador lo exige. Avanzar solo desde el presentador no cuenta.
- Escena 24: haz clic en cada video de referencia para escucharlo.
- Escena 25: el tema arranca en el último paso, desde 75,05 s, donde suenan las dos voces juntas. Lo cortas con otro clic, con `M` o al salir.
- Escena 26: los efectos suenan solos en el cuadro de impacto de cada animación.
- Videos, música y replays se detienen al salir de su escena o si la ventana queda oculta.
- Con «reducir movimiento» del sistema, las animaciones quedan quietas en un momento representativo y sin transiciones. Los replays esperan un botón de reproducir. Para probarlo: `index.html?motion=reduce`.

## Material

Las diapositivas no llevan rótulos. La procedencia está en el campo `source` de `contenido-v2.json` y se ve en el presentador.

- **Replay**: el renderer del juego dibuja el tablero desde estados re-simulados de partidas reales (`assets/clips`), a 2 px de diseño por píxel, como el resto. 02eb6795, 796f00b9 y fbc091c3 corren con el motor actual, y todos sus hashes verifican. 25fe89ae (10/10 puntos de control) y 77e80cf4 (61/61) corren con el motor histórico; el detalle está en `research/clips/README.md`.
- **Chat / código real**: los textos vienen literales de los replays (`citas-escenario.json`, `assets/data`), con traducción abreviada. El chat de la escena 21 es la primera sesión real de Claude Code (26 sep 2026).
- **Dibujos** (ajedrez y RTS, carrera de pensar, ritmos, teselas, sandbox): usan los sprites del juego y pasan por `rampDither`. `rampDither` es la copia en CPU del shader de dithering del juego (`packages/web/src/render/dither.ts`). Nunca pasan por datos de una partida.
- Sprites, atlas, sonidos y música son los archivos del juego. Todos los sprites van a la misma escala, como en el motor. El mineral es blanco, como lo pinta el renderer.
- Tomas de animación rechazadas reales: `assets/animations/*/rejected-*`. Referencias musicales: `assets/music-refs` (25 s cada una). Logos oficiales: BipBop.cl, Revi, CChC y Hugging Face. Portada: imagen de Codex `assets/portada-reyes-v11.png`.

## Editar y regenerar

- Guion y tiempos: la fuente es `contenido-v2.json`. `guion.md`, `estructura.md` y `relato-completo.md` vienen de la v2 y no reflejan la v3. Después de cambiar el JSON, corre `node build-notes.mjs`. Regenera `notes.js`. Falla si las escenas del HTML no coinciden en id u orden o si falta una indicación por paso. Avisa si el total no es 1380 s.
- Escenas: `index.html` (contenido, pasos `data-in`/`data-out`, indicaciones `data-cues`), `slides.css` (diseño), `slides.js` (navegación, pasos, presentador, audio), `scenes.js` (animaciones).
- Renderer: `node build-game.mjs` compila `game.ts` → `game.js` con el `GameRenderer` del juego y copia los sprites.
- Clips: `npx tsx talks/devday-concepcion-2026/tools/build-clips.mts`, desde la raíz del repo. Re-simula y empaqueta las ventanas. Falla si una ventana queda incompleta o un replay no verifica.
- `tools/verify-replays.mts` re-simula `research/replays` con el motor actual. `tools/peek.mjs` captura con un Chrome headless aislado.

## Investigación

- `investigacion-v2.md`: música, sonidos, wait, timeout y chats.
- `research/`: inventario del corpus, partidas seleccionadas, clips históricos y su evidencia.
- `investigacion-estilo.md`, `investigacion-juego.md` e `investigacion-charlas.md`.

## Antes del evento

1. Ensaya en voz alta con el presentador y el reloj.
2. Prueba en el proyector. La presentación se ajusta a cualquier 16:9 a resolución nativa.
3. Confirma el texto de la portada.
