# Cambios derivados de la revisión de RTS

## Alcance

Implementación del 7 de octubre de 2026 en el checkout local, con las reglas
`v21d-no-unlocks` intactas. La auditoría citada revisó v21c;
las investigaciones de desbloqueo ya no existían antes de esta implementación.
No cambian: reservar construcciones (punto 2), el cursor de `run`
(4), la condición de victoria (12) y la función objetivo del optimizador (10).

## Contexto y control del agente

- `v23-reactive-orders` ejecuta scripts también cuando hay una orden activa. El
  agente puede usar `continueOrder`, `suspendOrder` y `cancelOrder`, y devolver
  callbacks `onTick`, `onAttacked`, `onEnemySeen` y `onOrderEnded`. No hay
  represalia obligatoria: si nada la interrumpe, la orden activa continúa. Suspender
  una construcción libera el sitio y reinicia el trabajo al retomarla. Las reacciones comparten presupuesto y una sola acción por tick.
  El daño llega al tick siguiente. Los atacantes ocultos no revelan identidad.
  Los replays sin `reactiveOrders` conservan la precedencia histórica y no
  ejecutan callbacks.

- El sandbox cobra todo el trabajo alcanzable desde scripts, incluida la carga
  del mundo y el formato de errores, y protege los objetos globales del prelude. El servidor ejecuta la VM de cada jugador en un worker propio,
  con un límite externo de 250 ms por solicitud (arranque: hasta 10 s). El
  contador determinista es el límite normal; el watchdog (vigilante de tiempo
  real) es solo una emergencia. Una VM terminada no se
  reinicia para ocultar la pérdida de memoria: produce `hold` y un error. También
  supervisa `run`, la compilación y las pruebas de scripts.
- Una terminación por tiempo real queda en `operationalFailures`. El replay y el
  optimizador no la aceptan como evidencia reproducible: depende de la máquina,
  no del balance.

- Actualización del 8 de octubre: MCP ya no tiene `wait`. Codex recibe una
  observación al terminar cada decisión y retoma la misma sesión, aislada por
  partida. Claude recibe la observación con su hook. Los conectores que
  reinician procesos mantienen su política declarada de contexto nuevo. La
  espera HTTP/CLI sigue disponible para operadores y por compatibilidad.
- Tras el vencimiento, el watchdog relee el estado compartido antes de terminar
  una VM. Separa el despacho al worker (hasta 1 s) de la ejecución
  (250 ms). Los fallos confirmados aparecen en estado y visor, sin reiniciar
  memoria. Esto corrige una carrera reproducida y evita cobrar
  el despacho como ejecución. La causa exacta de los 2 cierres históricos sigue
  sin evidencia suficiente.
- El estado muestra resultados efectivos de órdenes y scripts, costos y
  bloqueos vigentes, daño y bajas observadas (hasta 2 minutos, con aviso de
  truncamiento) y avistamientos históricos de unidades. No da recomendaciones
  estratégicas.
- `self` expone enfriamientos restantes, tiempo de puntería, el resultado
  efectivo de la decisión anterior y `canMove(dir)`. Esta consulta devuelve
  `null` si necesita una casilla oculta; no revela ocupación tras la niebla.
  Los resultados distinguen acción realizada, bloqueo, espera por enfriamiento,
  puntería, llegada, mantener posición y acción inválida.
- La herramienta `script_test` (y `POST /scripts/:kind/test`, `castellan script-test`)
  se retiró: solo el 9% de los jugadores la usaba y sus resultados no
  predecían el éxito de las acciones. Instalar un script lo compila y
  rechaza el código que no compila. `Match.testScript` queda solo
  para los tests del motor.
- `pnpm docs:rules` genera [CURRENT-RULES.md](CURRENT-RULES.md) desde las reglas
  y la guía. `pnpm docs:check` detecta divergencias y corre al iniciar
  `pnpm test`. BALANCE y GDD quedan marcados como documentos históricos.

## Mediciones reproducibles

Cada replay nuevo incluye `experiment`:

- Revisión Git; SHA-256 de las fuentes del motor, sandbox, servidor, simulador
  y conectores, y del lockfile; versión de Node. El hash distingue un checkout
  modificado de su commit base. No guarda las fuentes: repetir una
  ejecución exige archivar el checkout.
- Hash de las reglas completas (con el mapa) y de la guía base, sin el marcador
  de serie, que cambia. El replay sigue guardando semilla, reglas, tick rate,
  asientos, equipos y órdenes.
- Modelo, esfuerzo, conector, versión, hash del prompt de tarea y
  políticas de memoria y contexto por jugador. Los launchers de Codex, Claude Code,
  OpenCode, DeepSeek y Antigravity los reportan antes de jugar. Lo desconocido
  es `null`; no se deduce del nombre visible ni se atribuye un modelo a un alias. El hash no incluye el system prompt privado del proveedor.
- Historial de cambios de configuración, incluido reiniciar un agente.
  `POST /agent-config` acepta solo esos campos, con token propio. No inicia la
  partida ni lee su estado. Un cliente personalizado puede declararlos;
  eso no demuestra la identidad del proveedor.
- Modo (independiente o serie) y una traza acotada de las llamadas iniciadas
  hasta el cierre: herramienta, ticks de observación, inicio y respuesta,
  duración, estado HTTP y fallo lógico. La traza no guarda cuerpos, claves,
  tokens ni chat privado. El límite es 20.000 llamadas; el exceso descartado
  queda contado. Al terminar, el servidor espera respuestas pendientes
  hasta 1 segundo antes de guardar y avanzar la serie. Si una conexión no
  responde, su entrada queda con estado, duración y respuesta `null`, sin
  inventar una llamada completa.
- Errores de herramientas, órdenes rechazadas, antigüedad de observaciones y el
  mayor intervalo sin órdenes aceptadas. Este último no mide la inactividad de
  los scripts autónomos. La latencia real sigue afectando la partida.

Un cliente personalizado los declara con `agent` por asiento al crear la sala, `POST /agent-config`, o las variables `CASTELLAN_MODEL`, `CASTELLAN_EFFORT`,
`CASTELLAN_CONNECTOR`, `CASTELLAN_CONNECTOR_VERSION`, `CASTELLAN_PROMPT_SHA256`, `CASTELLAN_MEMORY_POLICY`,
`CASTELLAN_CONTEXT_POLICY` para CLI/MCP. No envíe credenciales ni el prompt crudo.

## Acceso del espectador

Crear una sala devuelve un enlace `/watch/id#spectator=...` (o
el equivalente de serie). La capacidad (permiso de lectura) se conserva al
restaurar. No aparece en listados, respuestas del jugador ni
replay. El navegador usa el fragmento para autorizar el WebSocket y la lectura
de scripts. El servidor rechaza tokens de jugadores y capacidades de otras
salas. Las partidas terminadas son públicas.

El organizador guarda ese enlace fuera del contexto del jugador. Compartir la
capacidad da acceso; no aísla procesos que comparten permisos de
lectura en el host. Los launchers propios limitan a los agentes a sus
herramientas de juego.

## Balance y mapas

[BALANCE-WORKFLOW.md](../packages/sim/BALANCE-WORKFLOW.md) describe el flujo de
reconstrucción, las particiones y los comandos. Los bots leen costos,
requisitos y colas de las reglas de su partida; los rechazos quedan guardados.
Los snapshots antiguos que perdían estado de scripts no son fiables.

La redistribución conserva el mineral total y mueve parte de las minas
iniciales a flancos exteriores. Hay pruebas de simetría, acceso y reproducción
del mapa histórico. Su superioridad estratégica requiere comparar partidas. [La investigación aplicada](RTS-DESIGN-RESEARCH.md)
define esas mediciones y las consecuencias concretas de When Agents Rule,
Sirlin y Casteel.
