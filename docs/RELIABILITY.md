# Cambios derivados de la revisión de RTS

## Alcance

Implementación del 7 de octubre de 2026 sobre el checkout local, conservando las
reglas existentes `v21d-no-unlocks`. La auditoría citada se hizo sobre v21c; las
investigaciones de desbloqueo ya habían sido retiradas antes de esta implementación.
No se cambió la mecánica de reservar construcciones (punto 2), el cursor de `run`
(4), la condición de victoria (12), ni la función objetivo del optimizador (10).

## Contexto y control del agente

- `v23-reactive-orders` ejecuta scripts también mientras hay una orden. El agente
  puede usar `continueOrder`, `suspendOrder` y `cancelOrder`, y devolver callbacks
  `onTick`, `onAttacked`, `onEnemySeen` y `onOrderEnded`. No se agrega represalia
  obligatoria: sin interrupción explícita, la orden activa continúa. Suspender
  una construcción libera el sitio y reinicia el trabajo al retomarla. Las
  reacciones comparten presupuesto y una sola acción por tick; el daño llega al
  tick siguiente y los atacantes ocultos no revelan identidad. Los replays sin
  `reactiveOrders` conservan la precedencia histórica y no ejecutan callbacks.

- El sandbox cobra todo el trabajo alcanzable desde scripts, incluida carga del
  mundo y formato de errores, y protege los objetos globales del prelude. El
  servidor ejecuta cada VM de jugador en un worker separado, con un límite externo
  de 250 ms por solicitud (arranque hasta 10 s). El contador determinista sigue
  siendo el límite normal; el watchdog es una protección de emergencia. Una VM
  terminada no se reinicia ocultando la pérdida de memoria: produce `hold` y error.
  También se supervisan `run`, compilación y pruebas de scripts.
- Una terminación por tiempo real se registra como `operationalFailures`; el
  replay y el optimizador la rechazan como evidencia reproducible. La emergencia
  depende de la máquina y no debe interpretarse como resultado de balance.

- Actualización del 8 de octubre: `wait` fue retirado de MCP. Codex recibe una
  observación al finalizar cada decisión y retoma la misma sesión, aislada por
  partida. Claude recibe la observación mediante su hook. Los conectores que
  reinician procesos conservan su política declarada de contexto nuevo. La
  espera HTTP/CLI sigue disponible para operadores y compatibilidad.
- El watchdog vuelve a leer el estado compartido después del vencimiento, antes
  de terminar una VM. Distingue despacho al worker (hasta 1 s) de ejecución (250 ms).
  Los fallos confirmados aparecen en estado y visor; no se reinicia memoria.
  Esto corrige una carrera reproducida y evita cobrar despacho como ejecución;
  la causa exacta de los dos cierres históricos sigue sin evidencia suficiente.
- El estado muestra resultados efectivos de órdenes/scripts, costos y bloqueos
  vigentes, daño y bajas observadas (hasta dos minutos, indicando truncamiento),
  y avistamientos históricos de unidades. No contiene recomendaciones estratégicas.
- `self` expone enfriamientos restantes, tiempo de puntería, resultado efectivo
  de la decisión anterior y `canMove(dir)`. Esta consulta devuelve `null` si
  requeriría conocer una casilla oculta; no revela ocupación tras la niebla.
  Los resultados distinguen acción realizada, bloqueo, espera por enfriamiento,
  puntería, llegada, mantener posición y acción inválida.
- La herramienta `script_test` (y `POST /scripts/:kind/test`, `aoa script-test`)
  se retiró: la usaba el 9% de los jugadores y sus resultados no predecían el
  éxito de las acciones. Instalar un script compila el código y rechaza el que
  no compila; `Match.testScript` queda solo para los tests del motor.
- [CURRENT-RULES.md](CURRENT-RULES.md) se genera desde reglas y guía mediante
  `pnpm docs:rules`. `pnpm docs:check` detecta divergencias y se ejecuta al iniciar
  `pnpm test`. BALANCE y GDD quedaron
  identificados como documentos históricos.

## Mediciones reproducibles

Cada replay nuevo incluye `experiment`:

- Revisión Git, SHA-256 de las fuentes del motor/sandbox/servidor/simulador,
  fuentes de conectores y lockfile, y versión de Node. El hash distingue un
  checkout modificado de su commit base. No conserva las fuentes: archivar el
  checkout sigue siendo necesario para repetir una ejecución.
- Hash de las reglas completas (incluido mapa) y de la guía base, sin el marcador
  cambiante de una serie. El replay sigue guardando semilla, reglas, tick rate,
  asientos, equipos y órdenes.
- Modelo, esfuerzo, conector, versión, hash del prompt de tarea y políticas de
  memoria/contexto por jugador. Los launchers de Codex, Claude Code, OpenCode,
  DeepSeek y Antigravity los reportan antes de jugar. Lo desconocido es `null`;
  no se deduce del nombre visible ni se atribuye un modelo concreto a un alias.
  El hash no incluye el system prompt privado del proveedor.
- Historial de cambios de configuración, incluido reiniciar un agente. La ruta
  `POST /agent-config` acepta únicamente esos campos, con token propio, y no
  inicia la partida ni lee su estado. Un cliente personalizado puede declararlos;
  esa declaración no demuestra la identidad del proveedor.
- Modo independiente o serie y traza acotada de llamadas iniciadas hasta el
  cierre: herramienta, ticks de observación/inicio/respuesta, duración, estado
  HTTP y fallo lógico. No se guardan cuerpos, claves, tokens ni chat privado en
  esta traza. El límite es 20.000 llamadas; se cuenta el exceso descartado.
  Al terminar se esperan las respuestas pendientes hasta un segundo antes de
  guardar y avanzar la serie. Si una conexión no responde, su entrada conserva
  estado/duración/respuesta `null`; no se inventa una llamada completa.
- Errores de herramientas, órdenes rechazadas, antigüedad de observaciones y
  mayor intervalo sin órdenes aceptadas. Este último no mide inactividad de los
  scripts autónomos. La latencia real sigue afectando la partida.

Clientes personalizados pueden declarar `agent` por asiento al crear una sala,
usar `POST /agent-config`, o suministrar variables `AOA_MODEL`, `AOA_EFFORT`,
`AOA_CONNECTOR`, `AOA_CONNECTOR_VERSION`, `AOA_PROMPT_SHA256`, `AOA_MEMORY_POLICY`,
`AOA_CONTEXT_POLICY` a CLI/MCP. No enviar credenciales ni el prompt crudo.

## Acceso del espectador

La creación devuelve un enlace `/watch/id#spectator=...` (o equivalente de serie).
La capacidad se conserva al restaurar una sala/serie; no aparece en listados,
respuestas del jugador ni replay. El navegador usa el fragmento para autorizar
la conexión WebSocket y lectura de scripts. Tokens de jugadores y capacidades
de otras salas se rechazan. Las partidas terminadas quedan disponibles al público.

El organizador debe conservar ese enlace fuera del contexto del jugador.
Una capacidad compartida voluntariamente concede el acceso: esto no aísla procesos
que comparten permisos de lectura sobre el host. Los launchers propios mantienen
los agentes limitados a sus herramientas de juego.

## Balance y mapas

El flujo de reconstrucción, particiones y comandos está en
[BALANCE-WORKFLOW.md](../packages/sim/BALANCE-WORKFLOW.md). Los bots leen costos,
requisitos y colas de las reglas de su partida; los rechazos se conservan.
No se consideran fiables los snapshots antiguos que perdían estado de scripts.

La redistribución conserva el mineral total y mueve parte de las minas iniciales
a flancos exteriores. La simetría, acceso y reproducción del mapa histórico tienen
pruebas; la superioridad estratégica de la distribución requiere comparar partidas.
[La investigación aplicada](RTS-DESIGN-RESEARCH.md) especifica esas mediciones y
las consecuencias concretas de When Agents Rule, Sirlin y Casteel.
