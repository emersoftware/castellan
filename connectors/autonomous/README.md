# Jugador autónomo de Castellan

Jugador de referencia para estudiar decisiones en una partida completa. Vive solo en este directorio; no cambia reglas, motor ni bots existentes. Usa las reglas de la sala y solo la vista y las acciones autorizadas de su jugador.

## Ejecutarlo

Desde la raíz del repositorio, con dependencias instaladas:

```sh
# Terminal 1: servidor normal del proyecto
pnpm server

# Terminal 2: crea una partida independiente y juega contra eco
pnpm exec tsx connectors/autonomous/cli.ts --practice eco --map open --out /tmp/castellan-player-01
```

`--practice` también acepta `rush`, `turtle`, `kite` y `archers`. En mapas de 4 asientos, `--practice` llena los otros asientos con el bot elegido. La consola muestra el enlace para observar y la ruta de registros.

Para una sala existente, asigna a `CASTELLAN_TOKEN` el token de **ese jugador** y ejecuta:

```sh
pnpm exec tsx connectors/autonomous/cli.ts --out /tmp/castellan-player-02
```

`CASTELLAN_SERVER` o `--server` cambian el servidor (por defecto `http://localhost:4400`). Usa un proceso y un directorio distintos por jugador. Para salas 2v2/FFA, crea la sala con el CLI existente (`pnpm castellan new --map quad --mode ffa --chat`) y conecta cada token por separado. La sala necesita chat habilitado al crearla.

El proceso espera la preparación, juega mientras avanza el reloj y termina en `finished`, incluso si el jugador cae antes que su equipo. `Ctrl-C` guarda la memoria. Al repetir el mismo comando, token y directorio, recupera sus planes. Rechaza un directorio de otra partida, jugador o reglas.

## Decisiones propias

La política local toma todas las decisiones: exploración, economía, expansión, construcción, composición, investigación, combate y chat. No consulta modelos externos ni tiene opciones para hacerlo. No necesita login en Codex/Claude ni claves de proveedores.

El jugador reevalúa la estrategia cada 5 segundos de juego. La rutina HTTP corre cada segundo (ajustable con `--poll`). Los scripts de unidades siguen cada tick. Separar estrategia y ejecución permite estudiar y cambiar la política dentro del jugador.

`AutonomousPlayer.step(view)` calcula estrategia y órdenes de forma síncrona. `feedback(orders, results, view)` procesa resultados reales. `planConstruction(...)` prepara escenarios de investigación con el mismo ejecutor. Al recuperar checkpoints de la versión anterior, descarta las opciones de asesoría y recalcula la estrategia local.

## Qué mantiene operativo

- Exploración de fronteras de niebla con scouts. Recuerda un tiempo a enemigos móviles y sigue edificios vistos. No trata coordenadas ocultas como posiciones enemigas conocidas.
- Workers que recolectan, descargan y huyen. Producción por castle, reserva de población y composición mixta. Elige expansiones por minas conocidas, distancia y peligro.
- Planes en orden de castle, tower, walls y doors. Reserva mineral hasta terminar la obra o confirmar su cancelación. No confunde una orden aceptada con una obra terminada. Recupera o abandona el plan ante constructores muertos, recibos perdidos, rechazos y obras estancadas.
- Scripts por tipo que siguen cada tick aunque el cliente tarde. Cubren defensa, blancos de ataque, kiteo de archer, retirada y reacción del King. Una retirada cancela el uso de scouts.
- Investigación según composición y presupuesto.
- Coordinación 2v2 y treguas FFA con mensajes estructurados `[CASTELLAN1]`. Valida remitente y equipo, limita la duración y cambia blancos tras mensajes aliados. Las treguas solo cambian la política de blancos; no cambian la hostilidad del motor. Una incursión cerca de la base rompe el acuerdo.

## Registros y límites de información

Cada directorio de ejecución tiene `trace.jsonl` y `memory.json`, sin token. La sesión registra sala y jugador, reglas, hashes del código, configuración y política local. Cada observación incluye el `PlayerView` recibido. Decisiones, órdenes intentadas, recibos, obras completadas, pérdidas y resultado final quedan enlazados por tick, tiempo y plan.

`execution-failure`, `execution-interrupted` y `execution-uncertain` indican rechazo, interrupción o recibo desconocido. `strategic-failure` indica que una elección dejó de ser defendible. Una derrota sola no prueba que una decisión concreta falló; atribuir causas exige comparaciones controladas.

El transporte de producción solo expone `/rules`, `/status`, `/state` y `/act`; el lanzador crea la sala antes. `validate.ts` usa el motor y datos de espectador para medir resultados **fuera** del controlador; al jugador solo le entrega vistas filtradas. `src/player.ts` no importa lógica del motor. Las partidas normales usan las reglas sin cambios.

## Repetir las pruebas

```sh
pnpm exec vitest run connectors/autonomous/test
pnpm exec tsc -p connectors/autonomous/tsconfig.json
pnpm docs:check

# Escenarios con evidencia JSON
CASTELLAN_EVIDENCE_DIR=/tmp/castellan-scenarios pnpm exec vitest run connectors/autonomous/test/scenarios.test.ts

# Diez partidas completas, rápidas, con reglas actuales y reloj simulado
pnpm exec tsx connectors/autonomous/validate.ts --out /tmp/castellan-matrix

# Una partida rápida completa, sin acortar el límite del juego
pnpm exec tsx connectors/autonomous/validate.ts --quick --out /tmp/castellan-quick

# Partida HTTP en tiempo real, con decisiones propias
pnpm exec tsx connectors/autonomous/live-validate.ts /tmp/castellan-live-new
```

Los escenarios cambian a propósito condiciones iniciales o geometría para aislar capacidades, y mantienen costos, tiempos de construcción y reglas de combate. Las partidas de la matriz usan las reglas normales: 10 minutos para 1v1 y 15 para 4 asientos. Desde v24, terminar sin ganador cuenta como derrota para todos. Las anteriores mantienen sus empates. Los tests HTTP cortos solo prueban transporte y recuperación; no cuentan como partidas normales.

Ver [evidencia y resultados](EVIDENCE.md), [matriz](evidence/matches.json) y [escenarios](evidence/scenarios.json). Las trazas y replays completos están comprimidos con gzip junto a sus resúmenes.

## Limitaciones conocidas

- Es una base para investigar, no un jugador competitivo. La apertura expansiva pierde ante presión temprana en `open`: en la matriz perdió los 4 encuentros ahí.
- La defensa que genera es una barrera corta con tower y puerta. No calcula un perímetro óptimo ni prueba que wallear convenga en todo mapa. Los proyectiles pasan sobre las paredes.
- La política usa umbrales y distancia aproximada para peligro y ubicaciones. El motor resuelve la navegación fina. Ante bloqueos reintenta con límites o abandona. No planifica evacuaciones navales ni capacidades inexistentes en el juego.
- El chat usa un protocolo pequeño, sin negociación libre. Nadie validó la coordinación estratégica con humanos o LLM que no usen `[CASTELLAN1]`.
- La persistencia tolera reinicios y recibos perdidos. No soporta varios procesos con el mismo token a la vez ni recupera un servidor que perdió la sala. El servidor sigue a cargo de autenticar capacidades.
- `pnpm typecheck` verifica el workspace y usa la configuración propia de Remotion para el paquete de video. El chequeo aislado de este jugador incluye además sus lanzadores y validadores.
