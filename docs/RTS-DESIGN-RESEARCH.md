# Investigación aplicada al diseño de AoA

Revisión: 7 de octubre de 2026. Fuentes primarias; el código de **When Agents Rule (WAR)** se revisó en [`d6319a2`](https://github.com/asp67/when-agents-rule/tree/d6319a2e00cb43797d044f748cca9fdbc10b0980), que seguía siendo su HEAD al consultar GitHub. Una implementación externa demuestra que una técnica existe, no que su juego tenga mejor balance. Los blogs siguientes son argumentos de diseño, no resultados experimentales sobre AoA.

## Cambio implementado: economía fuera de la base

En [maps.ts](../packages/shared/src/maps.ts) cada asiento conserva sus ocho minas iniciales, ahora de 250 en vez de 500. Los 2.000 restantes se distribuyen en cuatro minas de 500, en dos flancos exteriores. Se conservan las minas centrales, los recursos totales, las dimensiones y las fortificaciones.

| Mapa | Total antes y después | Mineral en sectores iniciales antes → después | Mineral exterior después |
| --- | ---: | ---: | ---: |
| open, fortress, ridge, canyons | 9.600 | 8.000 → 4.000 (83,3% → 41,7%) | 5.600 |
| fortress-quad | 21.600 | 16.000 → 8.000 (74,1% → 37,0%) | 13.600 |
| quad | 26.400 | 16.000 → 8.000 (60,6% → 30,3%) | 18.400 |

“Sector inicial” es el cuadrado local `x < 13 && y < 13`, exactamente el interior de una fortaleza. “Exterior” incluye las expansiones laterales y minas compartidas; **no significa que todo ese mineral sea igualmente disputado**. `quad` conserva además sus dos minas exteriores anteriores de 600 por asiento.

La intención es introducir una decisión concreta: explotar un flanco mientras se disputa el centro, o atacar el transporte rival. Concentrar todo lo relocalizado en el centro habría creado un único punto de control. Mantener las posiciones de las ocho minas iniciales preserva sus accesos; reducir reservas adelanta su agotamiento.

**Verificado:** [map-resources.test.ts](../packages/engine/test/map-resources.test.ts) comprueba los seis mapas: mineral total, casillas válidas sin solaparse con rocas/edificios, costos de caminos iguales bajo rotación, acceso rival a todas las expansiones sin destruir murallas y reproducción de una distribución histórica embebida en el replay. Los replays guardan el mapa completo; no vuelven a resolver su nombre contra `MAPS`.

**Todavía por medir en partidas:** primera extracción exterior, mineral efectivamente entregado desde afuera, workers perdidos en transporte, duración del control de cada flanco y retorno económico de una segunda castle. Una castle cuesta 600: cada nueva pareja de minas contiene 1.000, de modo que su defensa/producción o acceso a más de una pareja puede ser importante para justificarla. La simetría y accesibilidad están probadas; que esta distribución produzca mejores partidas sigue siendo una hipótesis. Comparar con el mapa histórico manteniendo agentes, semilla, reglas y lados intercambiados; no atribuir a las minas efectos de cambiar también los stats.

## Qué tomar concretamente de When Agents Rule

| Evidencia en WAR | Aplicación a AoA y comprobación necesaria |
| --- | --- |
| [`wait` es una acción vacía](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L6349-L6351); el [conductor vuelve a iniciar decisiones](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L9648-L9663) por tiempo y disponibilidad. | Separar conservar órdenes de bloquear una llamada. Eliminar la espera bloqueante requiere que **cada conector** vuelva a entregar observaciones por sí mismo. Probar un agente que decide no cambiar nada y luego recibe un ataque; debe recuperar el control sin polling infinito ni finalizar su proceso. La simulación sigue durante la inferencia. |
| [Daño y bajas se acumulan por encuentro](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/game.js#L2488-L2613), conservado hasta dos minutos. | Añadir un resumen factual de combates desde la última observación: daño, bajas, ubicación y momento, incluso si ya no queda ninguna unidad viva. Caso de aceptación: una pelea empieza y termina mientras el modelo piensa; su siguiente observación permite reconstruir qué perdió. No deducir automáticamente una recomendación táctica ni revelar enemigos nunca vistos. |
| [Clasifica órdenes como válidas, evitables o afectadas por cambios posteriores](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L603-L651), usando información de la observación. | Registrar `observedAtTick`, `appliedAtTick` y un código estable por rechazo. Probar por separado un ID inventado y un objetivo visible que muere durante la inferencia. Ambos rechazos cuestan tiempo al jugador; su explicación experimental es distinta. |
| [Expone costos y `blockedBy`](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L3757-L3793). | Ofrecer disponibilidad derivada de las validaciones reales: mineral, población, cola y requisitos de las reglas de esa partida. El estado ya incluye producción; falta evitar que el agente deba reconstruir todos los bloqueos. No conservar referencias a desbloqueos eliminados en v21d; los replays antiguos sí pueden tenerlos. |
| [Compara contratos completos por hashes](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/conditions.js#L56-L79). Un componente desconocido impide declarar equivalencia. | Manifiesto de motor, reglas/mapa, prompt, herramientas, modelo/esfuerzo, conector y memoria por asiento. Los nombres visibles de jugadores no sustituyen esa evidencia. Una repetición debe poder declarar exactamente qué mantuvo y qué cambió. No guardar claves ni ajustes secretos de conexión. |
| [Escenarios con solución y control negativo](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/tests/bench-scenarios.test.cjs#L18-L34) se prueban en rotaciones/reflejos. | Añadir escenarios pequeños para atasco, producción, defensa de una mina y retirada. Exigir que una referencia resuelva todos los lados y que quedarse quieto falle. Se comprueba que contexto y comandos permiten ejecutar la decisión; no se mezcla esta señal con la puntuación de balance. |
| [Órdenes persistentes limitan persecuciones y retoman el encargo](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/standing-orders.js#L21-L95). | Ejemplo de script: defender workers, perseguir solo dentro de un radio y regresar al puesto. Probar que un enemigo no arrastra toda la defensa. AoA debe conservar la libertad de programarlo; no hace falta imponer toda la automatización de WAR. |

Su [generador de recursos](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/terrain.js#L171-L197) combina rotación con una separación buscada respecto de las bases. Precisión importante: hace hasta 60 intentos; ese fragmento por sí solo **no garantiza** la exclusión para cualquier semilla. AoA tiene mapas fijos: podemos verificar exhaustivamente todos sus asientos, en vez de asumir igualdad porque las cantidades coinciden.

AoA ya recuerda edificios y depósitos vistos entre decisiones (`Match.refreshVision` / memoria de visión). Esa capacidad no debe presentarse como una carencia descubierta al comparar WAR. Las propuestas de esta tabla son pasos posteriores salvo cuando su implementación concreta esté documentada en el código y pruebas correspondientes.

## Lo que los blogs cambian en nuestro razonamiento

### 1. Un enfrentamiento no demuestra el valor completo de una opción

[Sirlin, Viable Options](https://www.sirlin.net/articles/balancing-multiplayer-games-part-2-viable-options) distingue balance global de igualdad en situaciones locales y propone buscar respuestas y contrarrespuestas. Para AoA esto **no obliga a reemplazar la función del optimizador**. Obliga a limitar la conclusión que sacamos de ella.

Experimento complementario: mismo presupuesto en knight/archer, con y sin espacio para replegarse, ante una tower y al atacar workers. Reportar por escenario supervivencia, daño y objetivo conseguido, sin promediarlos en una nueva nota. Si una composición vence en todos, investigar una opción dominante; si pierde en campo abierto y gana al irrumpir en una mina, conservar esa diferencia puede ser deseable. La identidad de las dos unidades sigue siendo una decisión del proyecto.

### 2. La retirada es parte del combate, no solo moverse hacia atrás

[Casteel, Control of Tactical Outcomes](https://waywardstrategy.com/2016/02/17/rts-design-thought-control-of-tactical-outcomes/) separa composición, posición, control durante la pelea y capacidad de salir de ella. En AoA el archer tarda 400 ms por movimiento, el knight 500 ms, y disparar exige apuntar. Ese conjunto puede permitir kitear o convertir una retirada en suicidio dependiendo de obstáculos, enfriamientos y script.

Experimento: repetir la misma pelea con retirada al 70%, 40% y 20% de HP, en terreno abierto y paso angosto. Medir mineral superviviente y tiempo de minas abandonadas. Si retirarse preserva ejército pero cede ingreso, hay una decisión real; si todas las retiradas mueren por órdenes bloqueadas, primero corregir interfaz/pathfinding. No agregar invulnerabilidad ni un botón de retirada sin esta evidencia.

### 3. Unidades generalistas pueden borrar decisiones

[Casteel, In Defense of Hard Counters](https://waywardstrategy.com/2021/07/27/hard-counters/) advierte que una unidad demasiado eficiente contra todo puede desplazar la composición y posición. El texto no demuestra que AoA necesite daños por clase ni una tercera unidad.

Experimento: enfrentar ejércitos 100/0, 75/25, 50/50, 25/75 y 0/100 bajo los mismos presupuestos, con scripts competentes y escenarios separados. Cruzar con incursión económica y defensa. Solo si la misma composición domina de forma persistente, revisar el rol que falta y después sus stats. “Mezclar siempre gana” tampoco debe ser el objetivo impuesto.

### 4. Una expansión debe ofrecer beneficio y una vulnerabilidad elegible

[Casteel, Progression and Equilibrium](https://waywardstrategy.com/2017/03/03/the-balance-of-power-progression-and-equilibrium-in-real-time-strategy-games/) analiza cómo pérdidas militares, de ingreso y de producción se refuerzan entre sí. En AoA una castle concentra defensa, depósito y producción: perderla puede golpear las tres capacidades a la vez.

Aplicación realizada: distribuir recursos exteriores en varios puntos. Experimento pendiente: comparar invertir primero en workers, ejército o castle exterior; después repetir perdiendo una expansión. Medir ingreso neto, tiempo de recuperación de producción y posibilidad de cambiar de flanco. Si el primer ganador económico controla toda la renta posterior, reducir recursos seguros podría **agravar** el efecto acumulativo: no dar el cambio por exitoso solo porque haya combate antes. No se modifican victoria, condición de empate ni costo de unidades por esta hipótesis.

## Criterio para la siguiente iteración

Primero pasar pruebas del motor/contexto y referencias ejecutables. Después ejecutar la comparación anterior/nueva con lados intercambiados y registrar sus manifiestos. Elegir con resultados de validación y consultar un conjunto de prueba final reservado una sola vez. Mantener la latencia real del modelo como parte de la competición, registrándola para explicar resultados. Estas fuentes orientan **qué medir y qué alternativas probar**; no reemplazan la prueba de nuestras reglas.
