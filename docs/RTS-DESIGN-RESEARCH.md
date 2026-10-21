# Investigación aplicada al diseño de Castellan

Revisión: 7 de octubre de 2026, con fuentes primarias. Revisamos el código de **When Agents Rule (WAR)** en [`d6319a2`](https://github.com/asp67/when-agents-rule/tree/d6319a2e00cb43797d044f748cca9fdbc10b0980), aún su HEAD al consultar GitHub. Una implementación externa demuestra que una técnica existe, no que su juego tenga mejor balance. Los blogs de abajo son argumentos de diseño, no resultados experimentales sobre Castellan.

## Cambio implementado: economía fuera de la base

En [maps.ts](../packages/shared/src/maps.ts) cada asiento conserva sus 8 minas iniciales, ahora de 250 en vez de 500. Los 2.000 restantes van a 4 minas de 500, en 2 flancos exteriores. No cambian minas centrales, recursos totales, dimensiones ni fortificaciones.

| Mapa | Total antes y después | Mineral en sectores iniciales antes → después | Mineral exterior después |
| --- | ---: | ---: | ---: |
| open, fortress, ridge, canyons | 9.600 | 8.000 → 4.000 (83,3% → 41,7%) | 5.600 |
| fortress-quad | 21.600 | 16.000 → 8.000 (74,1% → 37,0%) | 13.600 |
| quad | 26.400 | 16.000 → 8.000 (60,6% → 30,3%) | 18.400 |

“Sector inicial” es el cuadrado local `x < 13 && y < 13`: exactamente el interior de una fortaleza. “Exterior” incluye las expansiones laterales y las minas compartidas. **No significa que todo ese mineral sea igual de disputado**. `quad` conserva además sus 2 minas exteriores anteriores de 600 por asiento.

El objetivo es una decisión concreta: explotar un flanco mientras el jugador disputa el centro, o atacar el transporte rival. Todo el mineral movido al centro habría creado un único punto de control. Las 8 minas iniciales mantienen sus posiciones y accesos; con menos reserva, se agotan antes.

**Verificado:** [map-resources.test.ts](../packages/engine/test/map-resources.test.ts) comprueba en los 6 mapas: mineral total, casillas válidas sin solaparse con rocas/edificios, costos de caminos iguales bajo rotación, acceso rival a todas las expansiones sin destruir murallas y reproducción de una distribución histórica embebida en el replay.

Los replays guardan el mapa completo. No vuelven a buscar su nombre en `MAPS`.

**Todavía por medir en partidas:** primera extracción exterior, mineral entregado desde afuera, workers perdidos en transporte, duración del control de cada flanco y retorno económico de una segunda castle. Una castle cuesta 600 y cada nueva pareja de minas contiene 1.000. Para justificarla, quizá importen su defensa/producción o el acceso a más de una pareja. Simetría y acceso están probados. Que dé mejores partidas sigue siendo hipótesis. Compararla con el mapa histórico con los mismos agentes, semilla y reglas, y lados intercambiados. No atribuir a las minas efectos de cambiar también los stats.

## Qué tomar concretamente de When Agents Rule

| Evidencia en WAR | Aplicación a Castellan y comprobación necesaria |
| --- | --- |
| [`wait` es una acción vacía](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L6349-L6351); el [conductor vuelve a iniciar decisiones](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L9648-L9663) por tiempo y disponibilidad. | Separar mantener órdenes de bloquear una llamada. Sin espera bloqueante, **cada conector** debe volver a entregar observaciones por su cuenta. Probar un agente que decide no cambiar nada y luego recibe un ataque: debe recuperar el control sin polling infinito y sin terminar su proceso. La simulación sigue durante la inferencia. |
| [Daño y bajas se acumulan por encuentro](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/game.js#L2488-L2613), conservado hasta dos minutos. | Añadir un resumen factual de combates desde la última observación: daño, bajas, lugar y momento, aunque no quede ninguna unidad viva. Caso de aceptación: una pelea empieza y termina mientras el modelo piensa, y su siguiente observación le permite reconstruir qué perdió. No deducir una recomendación táctica automática ni revelar enemigos nunca vistos. |
| [Clasifica órdenes como válidas, evitables o afectadas por cambios posteriores](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L603-L651), usando información de la observación. | Registrar `observedAtTick`, `appliedAtTick` y un código estable para cada rechazo. Probar por separado un ID inventado y un objetivo visible que muere durante la inferencia. Ambos rechazos cuestan tiempo al jugador; su explicación experimental difiere. |
| [Expone costos y `blockedBy`](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L3757-L3793). | Mostrar disponibilidad derivada de las validaciones reales: mineral, población, cola y requisitos de las reglas de esa partida. El estado ya incluye producción. Falta evitar que el agente reconstruya todos los bloqueos. No mantener referencias a desbloqueos eliminados en v21d; los replays antiguos sí pueden tenerlas. |
| [Compara contratos completos por hashes](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/conditions.js#L56-L79). Un componente desconocido impide declarar equivalencia. | Manifiesto por asiento: motor, reglas/mapa, prompt, herramientas, modelo/esfuerzo, conector y memoria. Los nombres visibles de jugadores no reemplazan esa evidencia. Una repetición debe declarar exactamente qué mantuvo y qué cambió. No guardar claves ni ajustes secretos de conexión. |
| [Escenarios con solución y control negativo](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/tests/bench-scenarios.test.cjs#L18-L34) se prueban en rotaciones/reflejos. | Añadir escenarios pequeños de atasco, producción, defensa de una mina y retirada. Exigir que una referencia resuelva todos los lados y que quedarse quieto falle. Esto comprueba que contexto y comandos permiten ejecutar la decisión. No mezclar esta señal con la puntuación de balance. |
| [Órdenes persistentes limitan persecuciones y retoman el encargo](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/standing-orders.js#L21-L95). | Ejemplo de script: defender workers, perseguir solo dentro de un radio y volver al puesto. Probar que un solo enemigo no arrastra toda la defensa. Castellan debe mantener la libertad de programarlo, sin imponer toda la automatización de WAR. |

Su [generador de recursos](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/terrain.js#L171-L197) combina rotación con una separación buscada respecto de las bases. Precisión: hace hasta 60 intentos, así que ese fragmento por sí solo **no garantiza** la exclusión para cualquier semilla. Castellan tiene mapas fijos: podemos verificar todos sus asientos, en vez de suponer igualdad porque las cantidades coinciden.

Castellan ya recuerda los edificios y depósitos vistos entre decisiones (`Match.refreshVision` / memoria de visión). No es una carencia descubierta al comparar con WAR. Las propuestas de la tabla son pasos futuros, salvo las ya implementadas y documentadas en código y pruebas.

## Lo que los blogs cambian en nuestro razonamiento

### 1. Un enfrentamiento no demuestra el valor completo de una opción

[Sirlin, Viable Options](https://www.sirlin.net/articles/balancing-multiplayer-games-part-2-viable-options) distingue el balance global de la igualdad en situaciones locales y propone buscar respuestas y contrarrespuestas. Para Castellan esto **no obliga a reemplazar la función del optimizador**. Obliga a limitar lo que concluimos de ella.

Experimento complementario: mismo presupuesto en knight/archer, con y sin espacio para replegarse, ante una tower y al atacar workers. Reportar supervivencia, daño y objetivo logrado por escenario, sin promediarlos en una nota nueva. Si una composición gana en todos, investigar una opción dominante. Si pierde en campo abierto y gana al irrumpir en una mina, conviene quizá conservar esa diferencia. La identidad de las 2 unidades sigue siendo una decisión del proyecto.

### 2. La retirada es parte del combate, no solo moverse hacia atrás

[Casteel, Control of Tactical Outcomes](https://waywardstrategy.com/2016/02/17/rts-design-thought-control-of-tactical-outcomes/) separa composición, posición, control durante la pelea y capacidad de salir de ella. En Castellan el archer tarda 400 ms por movimiento, el knight 500 ms, y disparar exige apuntar. Según los obstáculos, los enfriamientos y el script, esto puede permitir kitear o volver suicida una retirada.

Experimento: repetir la misma pelea con retirada al 70%, 40% y 20% de HP, en terreno abierto y en un paso angosto. Medir mineral superviviente y tiempo con minas abandonadas. Si retirarse salva ejército pero cede ingreso, hay una decisión real. Si todas las retiradas mueren por órdenes bloqueadas, corregir primero la interfaz o el pathfinding. Sin esta evidencia, no agregar invulnerabilidad ni botón de retirada.

### 3. Unidades generalistas pueden borrar decisiones

[Casteel, In Defense of Hard Counters](https://waywardstrategy.com/2021/07/27/hard-counters/) advierte que una unidad demasiado eficiente contra todo puede dejar sin peso la composición y la posición. El texto no demuestra que Castellan necesite daños por clase ni una tercera unidad.

Experimento: enfrentar ejércitos 100/0, 75/25, 50/50, 25/75 y 0/100 con los mismos presupuestos, scripts competentes y escenarios separados. Cruzar con incursión económica y defensa. Solo si la misma composición domina siempre, revisar qué rol falta y después sus stats. “Mezclar siempre gana” tampoco debe ser meta impuesta.

### 4. Una expansión debe ofrecer beneficio y una vulnerabilidad elegible

[Casteel, Progression and Equilibrium](https://waywardstrategy.com/2017/03/03/the-balance-of-power-progression-and-equilibrium-in-real-time-strategy-games/) analiza cómo las pérdidas militares, de ingreso y de producción se refuerzan entre sí. En Castellan una castle reúne defensa, depósito y producción. Perderla puede dañar las 3 capacidades a la vez.

Ya aplicado: recursos exteriores en varios puntos. Experimento pendiente: comparar invertir primero en workers, en ejército o en una castle exterior. Después, repetir perdiendo una expansión. Medir ingreso neto, tiempo de recuperación de producción y posibilidad de cambiar de flanco. Si el primer ganador económico controla toda la renta posterior, reducir los recursos seguros podría **agravar** el efecto acumulativo. Más combate temprano no basta para dar el cambio por exitoso. Esta hipótesis no cambia la victoria, la condición de empate ni el costo de las unidades.

## Criterio para la siguiente iteración

1. Pasar las pruebas del motor/contexto y las referencias ejecutables.
2. Ejecutar la comparación entre el mapa anterior y el nuevo con lados intercambiados, y registrar sus manifiestos.
3. Elegir con los resultados de validación. Consultar una sola vez un conjunto de prueba final reservado.

La latencia real del modelo es parte de la competición; la registramos para explicar resultados. Estas fuentes orientan **qué medir y qué alternativas probar**. No reemplazan la prueba de nuestras reglas.
