# Dirección visual · v2

Dos mundos, como pidió Emerson.

**Antes de hablar del juego (escena 1): blanco.** Fondo blanco, Helvetica Neue, tinta #161513. Logos oficiales en su color: wordmark BipBop.cl (inline, Instrument Serif local, «Bop» en #3d7a3a), Revi horizontal y CChC a color (recortado del lockup oficial Revi | CChC de app.ia-revi.cl, sin modificar el arte). Revi en 17 municipalidades sobre una matriz de 75 puntos (meta a fines de 2027), con fuente. Transiciones suaves; al final una ventana al mapa del juego se abre en la página blanca.

**Desde la portada: el juego.** La portada entra por una disolución Bayer 4×4, la misma trama del juego. Todo lo que sigue usa la identidad de la web y del renderer:

- Negro como el mapa sin explorar. Títulos en Times New Roman con el dither suave de la interfaz (filtro SVG de `DitherDefs.tsx`, con celdas de ~2 px de diseño para que se vean en un proyector). Texto en Arial; código en Menlo.
- Colores: niveles EGA de la interfaz (blanco, gris #aaa, amarillo #ffff55, cian #55ffff) y las rampas por jugador del renderer (azul acero, brasas, verdín, amatista), más pasto y mineral.
- Entradas con el «palette fade» de la landing: negro, un tercio, dos tercios, completo.
- Sprites y atlas reales del juego, tramados en vivo con el dither del juego (`cpuDither`) en la rampa de cada jugador, siempre a escala entera de píxeles de dispositivo.
- Partidas con el `GameRenderer` real (Pixi) y su reveal por dither, a 2 px de diseño por píxel de canvas.

**Lienzo.** 16:9 de 1920×1080 en `rem` (1 rem = 10 px de diseño), dibujado a la resolución nativa de la ventana: los canvas y el dither nunca se reescalan con un `transform`. Una idea por escena, texto legible a distancia (mínimo ~22 px de diseño en rótulos, 30–60 en texto, 84–136 en títulos).

**Movimiento con sentido.** Cada clic muestra lo que se está diciendo: turnos vs. tiempo real, el reloj que no espera, el registro real de cuándo pensaban/esperaban/actuaban los agentes, el reparto de responsabilidades modelo/harness/motor, el script del caballero ejecutándose, el pipeline de arte (hoja magenta → sin fondo → dither → rampas), MiniMax (inicio/fin → video → rechazos reales → revisión → atlas), la música desde `compose.py` con su plan de acordes sincronizado al audio real, sonidos generado vs. procesado, partidas reales para el tower rush, la tregua incumplida y el pacto de empate, y la regla nueva.

**Rótulos de honestidad.** «Replay» (amarillo) para tablero re-simulado de una partida, «Registro» / «Chat real» (gris) para datos literales, «Ilustración» (cian) para dibujos explicativos, «Paráfrasis» / «Hipótesis» / «Reflexión personal» (lila) para palabras del speaker. Sin nombres de modelos donde el relato no los necesita y sin cifras de benchmark.
