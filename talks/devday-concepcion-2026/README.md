# Charla Castellan · DevDay Exchange Community: Concepción

«Por y para agentes: construyendo un juego de estrategia con Codex y Claude» · martes 20 de octubre de 2026. 22 escenas, 23 minutos de contenido y 2 de margen o preguntas. Versión 3 (KISS: sin rótulos, todo centrado, un solo dithering); la v2 está en `versiones/v2` y la v1 en `versiones/v1`.

## Abrir

En macOS, doble clic en `iniciar.command`: levanta un servidor local en esta carpeta (http://127.0.0.1:8018, o un puerto libre) y abre el navegador. Ctrl+C lo cierra.

A mano: `python3 servir.py` desde esta carpeta (`--no-open` para no abrir el navegador). Usa ese servidor y no `python3 -m http.server`: responde peticiones Range, que Chrome necesita para repetir los videos y mover el audio.

Todo es local: fuentes, logos, audio, video y replays. No hay CDN ni llamadas a modelos. Para que funcione completa hay que abrirla con `iniciar.command` o `servir.py`: replays, atlas, datos y audio se cargan con `fetch`, que el navegador bloquea en `file://`.

## Presentar

- → espacio Page Down: siguiente paso. ← Page Up: paso anterior. Cada escena tiene varios pasos (71 en total). Retroceder vuelve exactamente al estado anterior.
- Inicio/Fin: primera/última escena. Número + Enter: ir a esa escena (17 Enter → diplomacia).
- `F` pantalla completa · `B` o `.` pantalla negra · `W` o `,` pantalla blanca · `O` índice · `M` silencio · `R` repetir la animación del paso · `V` video de respaldo (montaje local de partidas, por si WebGL falla en el proyector) · `?` ayuda.
- `P` abre la vista del presentador en otra ventana: escena y paso, la indicación del clic actual y del siguiente, el guion completo, fuentes, reloj con ritmo respecto del plan y lista de escenas. Desde ahí también se avanza y retrocede. Deja esa ventana en tu pantalla y la presentación en el proyector.
- Los enlaces directos sirven para ensayar: `index.html#diplomacy/2` abre la escena 17 en su tercer paso.
- El sonido solo empieza después de un clic o tecla en la ventana de la presentación (el navegador no deja sonar una página que no ha recibido un gesto; avanzar solo desde el presentador no cuenta). Escena 11: clic en cada video de referencia para escucharlo; el tema arranca en el último paso desde 75,05 s, donde suenan las dos voces juntas, y se corta con otro clic, `M` o al salir. Escena 12: los efectos suenan solos en el cuadro de impacto de cada animación (primer paso).
- Videos, música y replays se detienen al salir de su escena o si la ventana queda oculta. Con «reducir movimiento» del sistema las animaciones quedan quietas en un momento representativo, sin transiciones, y los replays esperan un botón de reproducir (para probarlo: `index.html?motion=reduce`).

## Material

Las diapositivas no llevan rótulos; la procedencia de cada cosa está en el campo `source` de `contenido-v2.json` y se ve en el presentador.

- **Replay**: tablero dibujado con el renderer del juego desde estados re-simulados de partidas reales (`assets/clips`), todos a 2 px de diseño por píxel, como el resto. 02eb6795, 796f00b9 y fbc091c3 se re-simularon con el motor actual y verificaron todos sus hashes; 25fe89ae (10/10 puntos de control) y 77e80cf4 (61/61) con el motor histórico, ver `research/clips/README.md`.
- **Chat / código real**: textos tomados literalmente de replays (`citas-escenario.json`, `assets/data`), con traducción abreviada. El chat de la escena 8 es la primera sesión real de Claude Code (26 sep 2026).
- **Dibujos** (ajedrez y RTS, carrera de pensar, ritmos, teselas, sandbox): hechos con los sprites del juego y pasados por `rampDither`, la copia en CPU del shader de dithering del juego (`packages/web/src/render/dither.ts`). Nunca se presentan como datos de una partida.
- Sprites, atlas, sonidos y música son los archivos del juego; todos los sprites van a la misma escala, como en el motor, y el mineral es blanco como lo pinta el renderer. Las tomas de animación rechazadas son reales (`assets/animations/*/rejected-*`). Referencias musicales recortadas en `assets/music-refs` (25 s cada una). Logos oficiales: BipBop.cl, Revi, CChC y Hugging Face. La bandera de la portada se dibuja en vivo con el emblema recortado de `assets/estandarte-codex.png`.

## Editar y regenerar

- Guion y tiempos: `contenido-v2.json` es la fuente (`guion.md`, `estructura.md` y `relato-completo.md` quedaron de la v2 y no reflejan la v3). Después de cambiarlo: `node build-notes.mjs` regenera `notes.js` y falla si las escenas del HTML no coinciden en id u orden, si falta una indicación por paso o si el total deja de ser 1380 s.
- Escenas: `index.html` (contenido, pasos `data-in`/`data-out`, indicaciones `data-cues`), `slides.css` (diseño), `slides.js` (navegación, pasos, presentador, audio), `scenes.js` (animaciones de cada escena).
- Renderer: `node build-game.mjs` compila `game.ts` → `game.js` con el `GameRenderer` del juego y copia los sprites.
- Clips: `npx tsx talks/devday-concepcion-2026/tools/build-clips.mts` (desde la raíz del repo) re-simula y empaqueta las ventanas; falla si una ventana queda incompleta o un replay no verifica.
- `tools/verify-replays.mts` re-simula replays de `research/replays` con el motor actual. `tools/peek.mjs` toma una captura con un Chrome headless aislado.

## Investigación

`investigacion-v2.md` (música, sonidos, wait, timeout, chats), `research/` (inventario del corpus, partidas seleccionadas, clips históricos y su evidencia), `investigacion-estilo.md`, `investigacion-juego.md`, `investigacion-charlas.md`.

Antes del evento: ensayar en voz alta con el presentador y el reloj, probar en el proyector (la presentación se ajusta a cualquier 16:9 a resolución nativa) y confirmar el texto de la portada.
