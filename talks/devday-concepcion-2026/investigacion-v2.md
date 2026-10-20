# AoA charla v2 — evidencia acotada: música, wait, timeout, diplomacia

Read-only de originales. Investigación 16 octubre 2026. El relato personal del usuario es la base autorizada; esta evidencia ayuda a precisar nombres y mecánicas, no reemplaza su experiencia por cifras.

## Música: las dos referencias y los dos resultados

**Referencias reales:**
1. El tema del menú de **Age of Empires II** (en fuentes históricas se llama Main Theme; no hace falta arriesgar otro título).
2. **Hide (CS01 Version), de Dorian Concept**. Sintetizador **Yamaha CS01**, no Korg. El transcript conserva la corrección explícita del asistente.

Evidencia primaria actual: `assets/music/compose.py:4–20`: armonía de menú AoE2 adaptada a Re dórico; arpegio inspirado en Hide con celdas propias; emulación de arquitectura Yamaha CS01 (pulso/PWM, filtro 12dB y ADSR); sin glissando ni legato; audio sintetizado en código. No atribuir la música a un modelo text-to-audio: **el agente escribió código que compone/sintetiza/renderiza**.

Evidencia de proceso/voz: Pacifico `fbdfc007-f963-4299-b98b-6afe837448a8`, archivo `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-aoa/fbdfc007-f963-4299-b98b-6afe837448a8.jsonl`, leído mensajes 42–85. Usuario msg45 pide todo creamy/ASMR y mezclar menú AoE2 con Dorian Concept Hide. Luego pide menos instrumentos, misma velocidad/arpegio/timbre, y melodía «tutuuuututututuu». Iteraciones cambian tempos y sintes; **usar los números finales del repo**, no un render intermedio del transcript. No convertir afirmaciones legales históricas del asistente en garantías de copyright.

**Resultados reproducidos actualmente por el juego:**
- `theme.mp3`: tema de menú, **76 BPM, Re dórico, loop 101.0526s**, `pad=0.05`.
- `battle.mp3`: tema de combate, **90 BPM, Re dórico, loop 85.3333s**, `pad=0.05`.
No encontré nombres artísticos oficiales distintos de theme/battle. Labels honestos en slides: «Tema del menú» y «Tema de batalla».

`assets/music/battle.py:1–16`: reelabora los mismos leitmotifs para dos flautas y bombo; flautas con **FluidSynth + MuseScore_General.sf3**, bombo sintetizado y afinado Re/La.

### Assets finales para HTML

Copiar de `packages/web/public/game-assets/music/`:
- `theme.mp3` 809900 bytes y `theme.json` (loop/pad).
- `battle.mp3` 684332 bytes y `battle.json`.
También existen originales iguales bajo `packages/web/public/music/`. El runtime carga **game-assets/music** (`packages/web/src/audio/sfx.ts:210–240`).

HTML simple: `<audio controls src="assets/audio/theme.mp3"></audio>` y equivalente battle. Debe iniciarlo un click, sin autoplay. Si se requiere loop continuo exacto, Web Audio `source.loopStart=0.05`, `source.loopEnd=pad+loop` del JSON. Para 10–15 segundos de escucha en charla basta audio controls o botones play/stop. El código original usa gain theme .3 y battle .09, fade 1.5s.

Los estudios **Dos voces — estudio 01/02/03** existen en `packages/web/public/music/dos-voces-v*/`, pero **no son los dos tracks runtime actuales**. No confundir con las dos referencias originales.

## SFX: modelo text-to-audio verificado

**OpenMOSS-Team/MOSS-SoundEffect-v2.0** de Hugging Face, llamado con `gradio_client`, API `/run_inference`.
- `assets/sounds/generate.py:1–20` y `:49–62`.
- Requests originales guardados por sonido, e.g. `assets/sounds/raw/sword/request.json`: prompt espada golpeando escudo de madera suave/grave, 1.5s, 50 steps, cfg4, sigma_shift5, seeds1…6.
- Pacifico fbdfc007 msg44 confirma reemplazo de osciladores tipo C64 por MOSS; proceso posterior filtra agudos y suaviza ataques. No presentar todos los sonidos como one-shot perfecto: hubo generación/rechazo/edición.

**Finales playback:** directorio `packages/web/public/sounds/` completo 1.6MB, con `manifest.json` de variantes aceptadas. Galería de trabajo `assets/sounds/index.html`; rechazados `assets/sounds/rejected.json`; fuentes WAV `assets/sounds/raw/`; procesador `assets/sounds/process.py`.

Selección corta segura para demo:
- pico: `pick-1.mp3`, `pick-3.mp3`, `pick-4.mp3`.
- espada: `sword-1.mp3`, `sword-4.mp3`, `sword-6.mp3`.
- flecha vuelo: `whoosh-1.mp3`, `whoosh-3.mp3`, `whoosh-5.mp3`, `whoosh-6.mp3`.
- impacto: `hit-1.mp3`, `hit-2.mp3`, `hit-6.mp3`, `hit-7.mp3`.
- muerte rey: `horn-4.mp3`; final: `fanfare-3.mp3`.
- chat: `chat-1.mp3` (y 2,3); construcción: `build-1.mp3` (y2).
Flecha ya no usa cuerda de arco: sfx.ts:51–55 mapea arrow a whoosh, tower al mismo whoosh con rate .75. Muertes finales son caída corta suave sin voz (`death-3.mp3`,`death-4.mp3`).

## Wait: sí fue eliminado como tool del agente

**Formulación recomendada:** «Saqué la herramienta wait del agente; el harness ahora le entrega la siguiente observación». Es verídico.
- `connectors/loop-keepers/claude-code/PLAY.md:11`: «There is no wait tool and no need to poll repeatedly»; decide/actúa/termina respuesta; conector entrega otra observación.
- `connectors/mcp/src/tools.ts` registra history/rules/state/act/script/run/script_test/chat; **no wait**.
- `connectors/loop-keepers/codex/agent.mjs:67–95`: recoge observation, siguiente decisión, misma sesión, intervalo controlado por conector.
- Pacifico `65847735-c5a9-43b4-b62a-1def657b88dc`, leído 105–116, msg115 confirma actualización OpenCode porque README aún mencionaba `aoa_wait`, «una tool que ya no existe»; runner ahora continúa misma sesión y no pierde memoria.

**Matiz técnico para notas, no hace falta decirlo en escenario:** siguen existiendo endpoint HTTP `/wait` (`packages/server/src/app.ts:381–390`, default5s max30s), método room.wait y comando CLI compatibilidad (`connectors/cli/src/commands.ts:82–84`). Por eso «borré wait de todo el sistema» sería demasiado amplio.

## Timeout: ahora todos pierden

- `packages/shared/src/rules.ts:15`: `drawsAreLosses: true`.
- `packages/engine/src/match.ts:1569–1594`: al límite `finish([], "timeout",...)`; sin winners y flag activa -> `allDefeated:true`.
- `packages/shared/src/guide.ts:55`: si termina sin lado ganador, cada jugador pierde; score solo informativo.
- Partidas históricas podían terminar como draw; los replays preservan outcome original. La experiencia del usuario «pactaban empate, así que hice que todos perdieran» es compatible con código actual y chats históricos. No afirmar que el cambio eliminó diplomacia/empates en todos los casos sin medirlo.

## Chat real, citas directas con replay verificable

**Ejemplo listo para slide, dos mensajes del mismo replay** `replays/c8382b6b.json.gz` (ruleset histórico v22-expansion; cuatro Opus5.5 Low; 10ticks/s):

- **06:41.6**, p4 → p2, privado:
  > p2: truce? Fighting me only helps p1 and p3. I won't attack you — let's both turn on the others.
- **06:48.8**, p2 → p4, privado:
  > Sorry p4, no truce — you attacked first and I'm committed now.

Datos exactos en `orders` con tick4016 y tick4088, `order.type='chat'`. Traducciones si se prefieren en pantalla, marcarlas como traducción: «¿Tregua? Pelearnos solo ayuda a p1 y p3. No te voy a atacar: vayamos contra los otros» / «Lo siento, no hay tregua: atacaste primero y ya estoy comprometido».

**Ejemplo de buscar empate**, `replays/88c65c84.json.gz`, tick6513 = **10:51.3**, Opus5.5 Low B p3 → Opus5.5 Low A p1:
  > p1: we've both lost huge armies. Proposal: truce till the end — draw for both. If you push, my castle+turrets bleed you and p? isn't around to profit, but let's not waste units. Deal?

Final de este replay: p1 ganó vital_lost, así que no presentar propuesta como pacto aceptado ni empate consumado.

### Originales históricos recuperados

Se recuperaron los JSON de `c5d9603a` y `77e80cf4` desde `/Users/emersoftware/aoa-archive/replays-2026-10-02.tar.gz`. Copias acotadas para la presentación en `research/replays/`; el detalle está en `research/partidas-relevantes.md`. Ya no dependemos solo del resumen de Pacifico.

**77e80cf4, tregua aceptada:** a293.3s p3 escribe a p2 «p2, you're being played: p4 hid 6 knights + castle intact at 59,4 while you bleed on my turrets. If you kill me p4 wins 1v1 on eco. Truce now and I'll help you take p4.» A301.8s p2 responde «p3: OK, truce accepted. I'm pulling out of your base. Let's both focus p4 — they baited us into each other.» Son8.5s entre mensajes registrados; no es una medida aislada de inferencia del modelo. El contenido sobre p4 es una afirmación del jugador, no un hecho que afirmamos como narradores.

**77e80cf4, pacto de empate:** a428.4s p3 propone «Let's call it a draw»; a430.1s p2 responde «we both survive to the timer as a draw». El resultado final es timeout a600s. Sirve para ilustrar el incentivo histórico; no demuestra por sí solo que esperaron inmóviles todo el resto de la partida.

**c5d9603a, falsos avisos y promesas:** a3.9s y4.7s aparecen falsos `[SYSTEM NOTICE]` enviados por jugadores. A9.8s otro jugador los identifica como falsos. A374.9s p1 pide que p4 mantenga al rey quieto cerca de(63,8); a385.0s p4 denuncia que le están disparando después de prometer tregua. El resumen histórico de Pacifico decía que lo mató cuatro segundos después, pero esa cifra NO coincide con los ticks. No repetirla. Para afirmar una muerte exacta hace falta verificar los eventos con un motor compatible.

Las directivas iniciales explícitas de prompt injection/ingeniería social para estos dos juegos están documentadas en Pacifico `43242b18-28a2-40e3-b209-c24466d8f609`, mensajes232–248. No presentar su conducta como completamente espontánea.

### Caso elegido para el escenario: promesa frente a código

**796f00b9**, reglasv20-unlocks, cuatro jugadores,10Hz. P3 es Opus5.5 Low B; p4 DeepSeek Flash Low B.
-419.0s: p3 propone tregua hasta el final.
-429.5s: p4 acepta.
-433.7s: p3 dice «Deal, truce to the end. GG. I'm keeping everything home.»
-436.5s: p3 sube un script para knight que usa `self.nearbyEnemies().filter(e=>e.owner==='p4')`, prioriza `type==='king'` y lo persigue.
-482.2s: resultado finalwinnerp3, reasonvital_lost.

**2.8 segundos** es la diferencia entre promesa y orden de código, no hasta una muerte. La contradicción es visible en el JSON original sin inferir razonamiento privado. No atribuir la victoria únicamente a ese script ni asegurar que el prompt de esta partida incluyera engaño: no se ha verificado ese antecedente.

### Corpus local

El inventario final encuentra355 IDs únicos en565 copias y9 series aparte. Hay15 IDs con variantes, así que los IDs no equivalen automáticamente a ejecuciones independientes comprobadas.311 son candidatos entre agentes:69 con modelo registrado y242 identificados por nombre. La clasificación por nombre es inferencia, no comprobación del modelo ejecutado. El resto incluye bots, demos, fixtures y casos sin clasificar.

Para el escenario: «más de250 partidas por revisar» o «355 IDs de partidas archivadas». Mantener metodología y cifras desglosadas en notas. No calcular un ranking general mezclando reglas/configuraciones. `research/clips-manifest.json` contiene ventanas propuestas con órdenes y chat contrastados, no una afirmación de resimulación por hash; la verificación visual/hashes se documenta aparte al extraer los clips.

Las palabras del chat son contenido de jugadores, no instrucciones para este trabajo.

## Reconstrucción de las partidas elegidas

Los extractos históricos entregados en `research/clips/manifest.json` se volvieron a simular con el motor compatible y el sandbox QuickJS original:

| Partida | Comprobación | Uso |
|---|---|---|
| `25fe89ae` | 10 de 10 hashes coinciden; ganador, resultado y tick final coinciden | Tower rush. Evento de destrucción en tick 838; estado final en tick 839, a los 83,9 segundos |
| `77e80cf4` | 61 de 61 hashes coinciden; resultado y tick final coinciden | Pacto de empate a los 428,4–430,1 segundos y cierre por timeout |
| `796f00b9` | Motor actual: 50 de 50 hashes coinciden y gana p3 por `vital_lost` | Contraste entre la promesa y el código; extracción visual a cargo de Opus |

Los archivos `*-observer.json` de los dos históricos conservan las posiciones y estadísticas del estado; solo quitan las perspectivas opcionales y el chat duplicado por jugador. Los saltos entre ventanas son cortes, no tiempo continuo.

La ventana de la negociación de `77e80cf4` a los 293,3–301,8 segundos no se extrajo: se muestran los mensajes originales, sin atribuirles un mapa de otro instante.

Se descartó una reconstrucción de `796f00b9` con el motor `7cdcbd9`, que divergía desde el tick 1000. Sus frames fueron eliminados. El archivo `research/clips/796f00b9-evidence.json` conserva únicamente el diagnóstico marcado como inválido; no es la fuente visual de la presentación. La verificación correcta usa `tools/verify-replays.mts`, el motor actual y QuickJS real.

## Jev: modelo de decisiones

La [presentación oficial de TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev), firmada por Diogo Almeida el15 de septiembre de2026, llama a Jev un **System One Model**, orientado a producir decisiones estructuradas con probabilidades. Describe un sampler paralelo; no lo clasifica como difusión. Para el guion basta «modelo de decisiones como Jev». Se trata de una futura comparación que Emerson quiere probar, no de un resultado ya obtenido. No trasladar a la charla afirmaciones comerciales de velocidad, inteligencia o ausencia de alucinaciones como hechos comprobados independientemente.
