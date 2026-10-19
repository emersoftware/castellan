# Jugador autónomo de Castellan

Jugador de referencia para estudiar decisiones durante una partida completa. Implementación independiente en este directorio; no cambia reglas, motor ni bots existentes. Usa las reglas de la sala y únicamente la vista y las acciones autorizadas de su jugador.

## Ejecutarlo

Desde la raíz del repositorio, con las dependencias instaladas:

```sh
# Terminal 1: servidor normal del proyecto
pnpm server

# Terminal 2: crea una partida independiente y juega contra eco
pnpm exec tsx connectors/autonomous/cli.ts --practice eco --map open --out /tmp/castellan-player-01
```

También admite `rush`, `turtle`, `kite` y `archers`. En mapas de cuatro asientos, `--practice` completa los otros asientos con el bot elegido. La consola entrega el enlace para observar y la ruta de los registros.

Para una sala existente, asigna `CASTELLAN_TOKEN` con el token de **ese jugador** y ejecuta:

```sh
pnpm exec tsx connectors/autonomous/cli.ts --out /tmp/castellan-player-02
```

`CASTELLAN_SERVER` o `--server` cambia el servidor (predeterminado `http://localhost:4400`). Usa un proceso y un directorio distintos por jugador. Crea salas 2v2/FFA con el CLI existente (`pnpm castellan new --map quad --mode ffa --chat`) y conecta cada token por separado. El chat debe estar habilitado al crear la sala.

El proceso espera preparación, juega mientras avanza el reloj y termina en `finished`, incluso si fue eliminado antes que su equipo. `Ctrl-C` guarda la memoria; reejecutar el mismo comando/token/directorio recupera los planes. Un directorio de otra partida, jugador o reglas se rechaza.

## Decisiones propias

Todas las decisiones las toma la política local del jugador: exploración, economía, expansión, construcción, composición, investigación, combate y chat. No hay integración ni opciones para consultar a modelos externos. No requiere login en Codex/Claude ni claves de proveedores.

La estrategia se reevalúa cada cinco segundos de juego. La rutina HTTP corre cada segundo (ajustable con `--poll`) y los scripts de unidades continúan cada tick. La separación entre estrategia y ejecución permite estudiar y cambiar la política dentro del propio jugador.

`AutonomousPlayer.step(view)` calcula estrategia y órdenes de forma síncrona. `feedback(orders, results, view)` procesa resultados reales. `planConstruction(...)` sirve para preparar escenarios de investigación con el mismo ejecutor. Al recuperar checkpoints de la versión anterior se descartan las opciones de asesoría y se recalcula la estrategia local.

## Qué mantiene operativo

- Exploración de fronteras de niebla con scouts, recuerdo temporal de enemigos móviles y seguimiento de edificios vistos. No trata coordenadas ocultas como posiciones enemigas conocidas.
- Workers con recolección, descarga y escape; producción por castle, reserva de población y composición mixta. Escoge expansiones por minas conocidas, distancia y peligro.
- Planes secuenciales de castle, tower, walls y doors. Reserva mineral hasta completar o confirmar la cancelación; no confunde aceptación con obra terminada. Recupera constructores muertos, recibos perdidos, rechazos y obras estancadas, o abandona el plan.
- Scripts por tipo que siguen cada tick, aun si el cliente tarda. Defensa, objetivos de ataque, kiteo de archer, retirada y reacción del King. Una retirada cancela el uso de scouts.
- Investigación según composición y presupuesto disponible.
- Coordinación 2v2 y treguas FFA mediante mensajes estructurados `[AOA1]`. Valida remitente/equipo, limita duración y cambia objetivos tras mensajes aliados. Las treguas solo cambian la política de blancos; no modifican la hostilidad del motor. Una incursión cerca de la base rompe el acuerdo.

## Registros y límites de información

Cada directorio de ejecución contiene `trace.jsonl` y `memory.json`, sin token. La sesión registra identidad de sala/jugador, reglas, hashes del código, configuración y política local. Cada observación incluye el `PlayerView` recibido; las decisiones, órdenes intentadas, recibos, obras completadas, pérdidas y resultado final quedan enlazados por tick/tiempo/plan.

`execution-failure`, `execution-interrupted` y `execution-uncertain` representan rechazo, interrupción o recibo desconocido. `strategic-failure` señala que una elección dejó de ser defendible; una derrota por sí sola no prueba que una decisión concreta se equivocó. La atribución causal necesita comparaciones controladas.

El transporte de producción solo expone `/rules`, `/status`, `/state` y `/act`. La creación de salas ocurre antes, en el lanzador. `validate.ts` usa el motor y datos de espectador para medir resultados **fuera** del controlador: solo entrega vistas filtradas al jugador. No importa lógica del motor en `src/player.ts` ni altera las reglas para jugar partidas normales.

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

Los escenarios modifican explícitamente condiciones iniciales/geometría para aislar capacidades; conservan costos, tiempos de construcción y reglas de combate. Las partidas de la matriz usan las reglas normales, 10 minutos para 1v1 y 15 para cuatro asientos. Desde v24, terminar sin ganador cuenta como derrota para todos; las partidas anteriores conservan sus empates. Los tests HTTP cortos solo prueban transporte/recuperación; no se cuentan como partidas normales.

Ver [evidencia y resultados](EVIDENCE.md), [matriz](evidence/matches.json), [escenarios](evidence/scenarios.json). Las trazas/replays completos están comprimidos con gzip junto a sus resúmenes.

## Limitaciones conocidas

- Es una base investigable, no un jugador competitivo optimizado. La apertura expansiva pierde ante presión temprana en `open`; en la matriz perdió los cuatro encuentros abiertos.
- La defensa generada es una barrera corta con tower y puerta; no resuelve automáticamente un perímetro óptimo ni demuestra que wallear sea rentable en todos los mapas. Los proyectiles del juego pasan sobre paredes.
- La política usa umbrales y distancia aproximada para peligro/ubicaciones. La navegación fina queda al motor; ante bloqueos reintenta con límites o abandona. No planifica evacuaciones navales ni capacidades inexistentes en el juego.
- Chat compatible mediante un protocolo pequeño; no interpreta negociación libre. No se ha validado coordinación estratégica con jugadores humanos o LLM que no usen `[AOA1]`.
- La persistencia tolera reinicios y recibos perdidos; no hay soporte de múltiples procesos controlando simultáneamente el mismo token ni recuperación de un servidor que haya perdido la sala. El servidor existente sigue siendo responsable de autenticar capacidades.
- `pnpm typecheck` verifica el workspace y usa la configuración propia de Remotion para el paquete de video. El chequeo aislado de este jugador incluye además sus lanzadores y validadores.
