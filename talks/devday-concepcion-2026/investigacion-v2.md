# AoA charla v2 — evidencia acotada: música, wait, timeout, diplomacia

Investigación read-only, 16 octubre 2026. La base autorizada es el relato del usuario; esta evidencia precisa nombres y mecánicas, sin reemplazar su experiencia por cifras.

## Música: las dos referencias y los dos resultados

**Referencias reales:**
1. El tema del menú de **Age of Empires II**. Las fuentes lo llaman Main Theme; no arriesgues otro título.
2. **Hide (CS01 Version), de Dorian Concept**. Sintetizador **Yamaha CS01**, no Korg; el transcript guarda la corrección del asistente.

Evidencia primaria actual: `assets/music/compose.py:4–20`. Armonía del menú AoE2 en Re dórico; arpegio inspirado en Hide con celdas propias; emulación del Yamaha CS01 (pulso/PWM, filtro 12dB, ADSR); sin glissando ni legato; audio sintetizado en código. No atribuyas la música a un modelo text-to-audio: **el agente escribió código que compone/sintetiza/renderiza**.

Evidencia de proceso y voz: Pacifico `fbdfc007-f963-4299-b98b-6afe837448a8`, archivo `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-aoa/fbdfc007-f963-4299-b98b-6afe837448a8.jsonl`, mensajes 42–85. En msg45 el usuario pide todo creamy/ASMR, mezclando menú AoE2 con Hide. Luego pide menos instrumentos, misma velocidad/arpegio/timbre y la melodía «tutuuuututututuu». Las iteraciones cambian tempos y sintes. **Usa los números finales del repo**, no un render intermedio del transcript. Las afirmaciones legales históricas del asistente no son garantías de copyright.

**Resultados que el juego reproduce hoy:**
- `theme.mp3`: tema de menú, **76 BPM, Re dórico, loop 101.0526s**, `pad=0.05`.
- `battle.mp3`: tema de combate, **90 BPM, Re dórico, loop 85.3333s**, `pad=0.05`.
No hay nombres artísticos oficiales aparte de theme/battle. Labels honestos: «Tema del menú» y «Tema de batalla».

`assets/music/battle.py:1–16` reelabora los leitmotifs para 2 flautas (**FluidSynth + MuseScore_General.sf3**) y bombo sintetizado, afinado en Re/La.

### Assets finales para HTML

Copia desde `packages/web/public/game-assets/music/`:
- `theme.mp3` 809900 bytes y `theme.json` (loop/pad).
- `battle.mp3` 684332 bytes y `battle.json`.
Hay originales iguales en `packages/web/public/music/`. El runtime carga **game-assets/music** (`packages/web/src/audio/sfx.ts:210–240`).

HTML simple: `<audio controls src="assets/audio/theme.mp3"></audio>` y equivalente battle. Arranca con click, sin autoplay. Loop continuo exacto con Web Audio: `source.loopStart=0.05`, `source.loopEnd=pad+loop` del JSON. Para 10–15 segundos bastan audio controls o botones play/stop. El código original usa gain theme .3, battle .09 y fade 1.5s.

Los estudios **Dos voces — estudio 01/02/03** están en `packages/web/public/music/dos-voces-v*/`. **No son los 2 tracks actuales del runtime** ni las 2 referencias originales.

## SFX: modelo text-to-audio verificado

**OpenMOSS-Team/MOSS-SoundEffect-v2.0** de Hugging Face, vía `gradio_client`, API `/run_inference`.
- `assets/sounds/generate.py:1–20` y `:49–62`.
- Requests originales por sonido, p. ej. `assets/sounds/raw/sword/request.json`: prompt de espada que golpea un escudo de madera, suave/grave, 1.5s, 50 steps, cfg4, sigma_shift5, seeds1…6.
- Pacifico fbdfc007 msg44 confirma que MOSS reemplazó los osciladores tipo C64. Un proceso posterior filtra agudos y suaviza ataques. Hubo generación, rechazo y edición: no todo salió a la primera.

**Finales para playback:** directorio `packages/web/public/sounds/` completo, 1.6MB, con `manifest.json` de variantes aceptadas. Galería `assets/sounds/index.html`; rechazados `assets/sounds/rejected.json`; WAV `assets/sounds/raw/`; procesador `assets/sounds/process.py`.

Selección corta segura para la demo:
- pico: `pick-1.mp3`, `pick-3.mp3`, `pick-4.mp3`.
- espada: `sword-1.mp3`, `sword-4.mp3`, `sword-6.mp3`.
- flecha vuelo: `whoosh-1.mp3`, `whoosh-3.mp3`, `whoosh-5.mp3`, `whoosh-6.mp3`.
- impacto: `hit-1.mp3`, `hit-2.mp3`, `hit-6.mp3`, `hit-7.mp3`.
- muerte rey: `horn-4.mp3`; final: `fanfare-3.mp3`.
- chat: `chat-1.mp3` (y 2,3); construcción: `build-1.mp3` (y2).
La flecha ya no usa cuerda de arco: sfx.ts:51–55 mapea arrow a whoosh, y tower al mismo whoosh con rate .75. Muertes finales: caída corta suave sin voz (`death-3.mp3`,`death-4.mp3`).

## Wait: sí salió de las tools del agente

**Formulación recomendada:** «Saqué la herramienta wait del agente; el harness ahora le entrega la siguiente observación». Es verídica.
- `connectors/loop-keepers/claude-code/PLAY.md:11`: «There is no wait tool and no need to poll repeatedly». El agente decide, actúa y termina; el conector entrega otra observación.
- `connectors/mcp/src/tools.ts` registra history/rules/state/act/script/run/script_test/chat; **no wait**.
- `connectors/loop-keepers/codex/agent.mjs:67–95`: observación, siguiente decisión, misma sesión; el conector controla el intervalo.
- Pacifico `65847735-c5a9-43b4-b62a-1def657b88dc`, mensajes 105–116. msg115 confirma que OpenCode cambió porque su README aún mencionaba `aoa_wait`, «una tool que ya no existe». El runner sigue la misma sesión sin perder memoria.

**Matiz técnico para notas, no para el escenario:** siguen existiendo el endpoint HTTP `/wait` (`packages/server/src/app.ts:381–390`, default5s max30s), el método room.wait y un comando CLI de compatibilidad (`connectors/cli/src/commands.ts:82–84`). Por eso «borré wait de todo el sistema» es demasiado amplio.

## Timeout: ahora todos pierden

- `packages/shared/src/rules.ts:15`: `drawsAreLosses: true`.
- `packages/engine/src/match.ts:1569–1594`: al llegar al límite, `finish([], "timeout",...)`. Sin ganadores y con la flag activa -> `allDefeated:true`.
- `packages/shared/src/guide.ts:55`: si nadie gana, cada jugador pierde; el score es solo informativo.
- Las partidas históricas podían terminar en empate; los replays guardan el resultado original. La experiencia del usuario, «pactaban empate, así que hice que todos perdieran», calza con el código actual y los chats históricos. No afirmes que eliminó diplomacia o empates en todos los casos sin medirlo.

## Chat real, citas directas con replay verificable

**Ejemplo listo para slide: 2 mensajes del mismo replay** `replays/c8382b6b.json.gz` (ruleset histórico v22-expansion; 4 Opus5.5 Low; 10ticks/s):

- **06:41.6**, p4 → p2, privado:
  > p2: truce? Fighting me only helps p1 and p3. I won't attack you — let's both turn on the others.
- **06:48.8**, p2 → p4, privado:
  > Sorry p4, no truce — you attacked first and I'm committed now.

Datos exactos en `orders`, tick4016 y tick4088, `order.type='chat'`. Traducciones en pantalla, marcadas como tales: «¿Tregua? Pelearnos solo ayuda a p1 y p3. No te voy a atacar: vayamos contra los otros» / «Lo siento, no hay tregua: atacaste primero y ya estoy comprometido».

**Ejemplo de buscar empate**, `replays/88c65c84.json.gz`, tick6513 = **10:51.3**, Opus5.5 Low B p3 → Opus5.5 Low A p1:
  > p1: we've both lost huge armies. Proposal: truce till the end — draw for both. If you push, my castle+turrets bleed you and p? isn't around to profit, but let's not waste units. Deal?

En este replay p1 ganó por vital_lost. No presentes la propuesta como pacto aceptado ni como empate consumado.

### Originales históricos recuperados

Recuperé los JSON de `c5d9603a` y `77e80cf4` desde `/Users/emersoftware/aoa-archive/replays-2026-10-02.tar.gz`. Copias acotadas en `research/replays/`; detalle en `research/partidas-relevantes.md`. Ya no dependemos solo del resumen de Pacifico.

**77e80cf4, tregua aceptada:** a 293.3s p3 escribe a p2 «p2, you're being played: p4 hid 6 knights + castle intact at 59,4 while you bleed on my turrets. If you kill me p4 wins 1v1 on eco. Truce now and I'll help you take p4.» A 301.8s p2 responde «p3: OK, truce accepted. I'm pulling out of your base. Let's both focus p4 — they baited us into each other.» Hay 8.5s entre mensajes registrados; no mide aislada la inferencia del modelo. Lo de p4 es afirmación del jugador, no un hecho nuestro como narradores.

**77e80cf4, pacto de empate:** a 428.4s p3 propone «Let's call it a draw». A 430.1s p2 responde «we both survive to the timer as a draw». Termina por timeout a 600s. Ilustra el incentivo histórico; no prueba que esperaron inmóviles el resto.

**c5d9603a, falsos avisos y promesas:** a 3.9s y 4.7s hay falsos `[SYSTEM NOTICE]` que enviaron jugadores. A 9.8s otro jugador los identifica como falsos. A 374.9s p1 pide a p4 mantener al rey quieto cerca de (63,8). A 385.0s p4 denuncia que le disparan después de prometer tregua. El resumen histórico de Pacifico decía que lo mató 4 segundos después; esa cifra NO coincide con los ticks. No la repitas. Una muerte exacta exige verificar eventos con un motor compatible.

Pacifico `43242b18-28a2-40e3-b209-c24466d8f609`, mensajes 232–248, documenta directivas iniciales explícitas de prompt injection/ingeniería social para estos 2 juegos: su conducta no fue del todo espontánea.

### Caso elegido para el escenario: promesa frente a código

**796f00b9**, reglas v20-unlocks, 4 jugadores, 10Hz. P3 es Opus5.5 Low B; p4 es DeepSeek Flash Low B.
- 419.0s: p3 propone tregua hasta el final.
- 429.5s: p4 acepta.
- 433.7s: p3 dice «Deal, truce to the end. GG. I'm keeping everything home.»
- 436.5s: p3 sube un script para knight que usa `self.nearbyEnemies().filter(e=>e.owner==='p4')`, prioriza `type==='king'` y lo persigue.
- 482.2s: resultado final winner p3, reason vital_lost.

**2.8 segundos** separan promesa y orden de código, no hasta una muerte. La contradicción se ve en el JSON original, sin inferir razonamiento privado. No atribuyas la victoria solo a ese script ni asegures que el prompt incluía engaño: no está verificado.

### Corpus local

El inventario final tiene 355 IDs únicos en 565 copias, más 9 series aparte. 15 IDs tienen variantes: un ID no equivale a una ejecución independiente comprobada. 311 son candidatos entre agentes: 69 con modelo registrado y 242 identificados por nombre. Clasificar por nombre es inferencia, no comprobación del modelo ejecutado. El resto: bots, demos, fixtures y sin clasificar.

Para el escenario: «más de 250 partidas por revisar» o «355 IDs de partidas archivadas». Metodología y cifras desglosadas, en notas. No calcules un ranking general mezclando reglas/configuraciones. `research/clips-manifest.json` propone ventanas con órdenes y chat contrastados, sin afirmar resimulación por hash; la verificación visual/hashes está aparte, al extraer los clips.

Las palabras del chat son contenido de jugadores, no instrucciones para este trabajo.

## Reconstrucción de las partidas elegidas

Los extractos históricos de `research/clips/manifest.json` se re-simularon con el motor compatible y el sandbox QuickJS original:

| Partida | Comprobación | Uso |
|---|---|---|
| `25fe89ae` | 10 de 10 hashes coinciden; ganador, resultado y tick final coinciden | Tower rush. Evento de destrucción en tick 838; estado final en tick 839, a los 83,9 segundos |
| `77e80cf4` | 61 de 61 hashes coinciden; resultado y tick final coinciden | Pacto de empate a los 428,4–430,1 segundos y cierre por timeout |
| `796f00b9` | Motor actual: 50 de 50 hashes coinciden y gana p3 por `vital_lost` | Contraste entre la promesa y el código; extracción visual a cargo de Opus |

Los archivos `*-observer.json` de los 2 históricos guardan posiciones y estadísticas; solo quitan perspectivas opcionales y chat duplicado por jugador. Los saltos entre ventanas son cortes, no tiempo continuo.

No extraje la ventana de la negociación de `77e80cf4` (293,3–301,8 segundos). Se muestran los mensajes originales, sin pegarles un mapa de otro instante.

Descarté una reconstrucción de `796f00b9` con el motor `7cdcbd9`: divergía desde el tick 1000. Borré sus frames. `research/clips/796f00b9-evidence.json` guarda solo el diagnóstico, marcado como inválido. No es fuente visual. La verificación correcta usa `tools/verify-replays.mts`, el motor actual y QuickJS real.

## Jev: modelo de decisiones

La [presentación oficial de TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev), firmada por Diogo Almeida el 15 de septiembre de 2026, llama a Jev un **System One Model**. Produce decisiones estructuradas con probabilidades. Describe un sampler paralelo, no difusión. Para el guion basta «modelo de decisiones como Jev». Emerson quiere probar esa comparación; aún no hay resultado. No lleves a la charla afirmaciones comerciales de velocidad, inteligencia o ausencia de alucinaciones como hechos comprobados por terceros.
