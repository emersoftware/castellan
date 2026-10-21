# Haciendo un RTS con Codex y Claude — estructura v2

Charla de 25 minutos: 23 de contenido con pausas y demostraciones, y 2 de margen. El dictado de Emerson reemplaza la narrativa de la primera versión. Versión íntegra corregida: [relato-completo.md](relato-completo.md). Texto de escenario: [guion.md](guion.md).

## Recorrido

1. Presentación personal y Revi.
2. El juego y la pregunta sobre tiempo de razonamiento.
3. Reglas y herramientas.
4. Cómo se construyó: código, imagen, animación y audio.
5. Diversión y experimentación.
6. Balance, diplomacia, engaño e incentivos.
7. Futura arena de comparación.

Antecedente central: el speaker construye agentes y equilibra calidad con velocidad. No lo sustituyas por el recuerdo de bots Java de la primera versión.

## Escenas y tiempos

| # | Tiempo | Escena | Duración |
|---|---|---|---|
| 1 | 00:00–01:00 | Soy Emerson | 60s |
| 2 | 01:00–01:20 | Haciendo un RTS con Codex y Claude | 20s |
| 3 | 01:20–02:30 | Un RTS para agentes | 70s |
| 4 | 02:30–04:00 | ¿Cuánto conviene pensar? | 90s |
| 5 | 04:00–04:45 | El juego es bastante sencillo | 45s |
| 6 | 04:45–05:45 | Cómo se conecta un agente | 60s |
| 7 | 05:45–06:35 | Que programen sus propias unidades | 50s |
| 8 | 06:35–07:35 | Ya tenía la idea y un SPEC.md | 60s |
| 9 | 07:35–08:20 | Primero, las imágenes | 45s |
| 10 | 08:20–09:50 | Después, hacerlos caminar | 90s |
| 11 | 09:50–11:30 | La música también salió de código | 100s |
| 12 | 11:30–12:25 | «Que sea lo más ASMR posible» | 55s |
| 13 | 12:25–13:10 | Me entretuve harto haciéndolo | 45s |
| 14 | 13:10–13:55 | Ponerlos a jugar | 45s |
| 15 | 13:55–15:25 | Lo que más hice fue balancear | 90s |
| 16 | 15:25–16:05 | Algunos se encerraban en su esquina | 40s |
| 17 | 16:05–17:50 | Con cuatro jugadores aparece la diplomacia | 105s |
| 18 | 17:50–19:05 | También probé que mintieran | 75s |
| 19 | 19:05–19:50 | El intento de romper el juego | 45s |
| 20 | 19:50–21:30 | Si se acaba el tiempo, todos pierden | 100s |
| 21 | 21:30–22:30 | Lo siguiente: una arena para comparar | 60s |
| 22 | 22:30–23:00 | Eso hice | 30s |

## Dirección visual solicitada

La introducción personal y Revi llevan fondo blanco y logos oficiales de BipBopLabs, CChC y Revi. Con el juego, el deck entra a su ambiente: primero una portada con estandarte y Claude cruzado por un espadazo. luego sus sprites, tipografía, dithering, sonido y renderizador reales. Claude Opus, esfuerzo max, desarrolla la presentación. Codex mantiene el relato.

Cada escena tiene acciones visuales pertinentes al relato, y el presentador las controla: unidades/tiempo, herramientas, pipeline de arte y audio, episodios de partidas, chat y reglas. El movimiento explica lo dicho. Las demostraciones construidas se distinguen de los replays reales. Funciona con archivos locales, sin llamadas a modelos.

## Criterio editorial

Conserva el humor y el lenguaje de Emerson. Las comparaciones de proveedores son observaciones de sus propias partidas, no resultados de un benchmark controlado. La reflexión sobre AGI (inteligencia artificial general) queda como impresión, y la influencia de saberse observado, como hipótesis. Separa las reglas históricas de las actuales. No inventes resultados para acompañar una buena anécdota.

Revi está en 17 municipalidades y la meta es 75 a fines de 2027, verificado en [app.ia-revi.cl](https://app.ia-revi.cl/). Música: menú de AoEII y Hide (CS01 Version) de Dorian Concept como referencias; audio real del juego para escuchar. SFX (efectos de sonido): MOSS-SoundEffect-v2.0. Modelos, archivos y notas de evidencia: [investigacion-v2.md](investigacion-v2.md).

## Ensayo y cortes

1. Dedica 10–15 segundos al tema musical y unos segundos a los efectos.
2. Muestra 1 sola negociación completa que quepa en el tiempo.
3. Si el ensayo se alarga, condensa la reflexión de AGI y la hipótesis de observación. Mantenlas en el relato completo.
4. No apures la dicción para conservar todo.
5. Ajusta los tiempos después del ensayo hablado.

La referencia final quedó como «un modelo de decisiones como Jev». Calza con la descripción oficial de TypeSafe como System One Model. La transcripción «full decision» sigue incierta. El texto no afirma que sea difusión ni traslada cifras comerciales de rendimiento.
