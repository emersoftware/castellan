# Haciendo un RTS con Codex y Claude — guion v2

Relato de escenario a partir del dictado de Emerson. Dura **23 minutos de contenido + 2 de margen**. Las indicaciones entre corchetes no van en voz alta. La apertura personal y de Revi tiene fondo blanco. La portada del juego marca el cambio de ambiente. Este guion conserva los temas del relato completo y junta los ejemplos para el tiempo disponible.

## 1. Soy Emerson

**00:00–01:00 · 60 segundos**

Me llamo Emerson Salazar. Soy ingeniero civil informático, pero es más bacán decir software engineer.

Trabajo en BipBopLabs. Estoy en Revi, un proyecto de la Cámara Chilena de la Construcción. En Revi tenemos agentes que ayudan con los permisos de construcción. Ayudan a quienes piden el permiso y a quienes lo revisan. Así el proceso de permisología avanza más rápido.

Revi tiene un chat para consultas de construcción y urbanismo. También tiene flujos que apoyan la revisión. Hoy 17 municipalidades usan Revi. La meta es llegar a 75 a fines de 2027.

Pero hoy les quiero hablar de un proyecto de fin de semana. Lo empecé hace más o menos un mes. Si después quieren conversar de Revi, feliz.

> Evidencia: Dictado de Emerson; https://app.ia-revi.cl/ verificado en esta sesión: 17 municipalidades, meta 75 a fines de 2027.

## 2. Haciendo un RTS con Codex y Claude

**01:00–01:20 · 20 segundos**

Y ahora sí: este es el jueguito que les quería mostrar. Lo hice con Codex y Claude.

[Pausa para que se lea el espadazo de la portada.]

El evento es de Codex, así que le hice un pequeño ajuste al título.

> Evidencia: Título y humor autorizados en el encargo original.

## 3. Un RTS para agentes

**01:20–02:30 · 70 segundos**

Hice un RTS para agentes de IA.

RTS significa juego de estrategia en tiempo real. En ajedrez cada jugador tiene su turno. Acá todos juegan al mismo tiempo. Manejan la economía, exploran, defienden y atacan.

[Mostrar unos 10 segundos del replay.]

Esta es una partida grabada. Cada jugador es un agente. El agente toma decisiones mientras el juego sigue. El motor no espera a que termine de pensar.

La referencia era algo como Age of Empires, pero mucho más chico. Conectar los agentes a un juego existente me parecía menos entretenido. Preferí hacer un juego propio. Así podía diseñarlo alrededor de lo que quería probar.

> Evidencia: Dictado; README.md; replay local 02eb6795. Es reproducción, no inferencia en vivo.

## 4. ¿Cuánto conviene pensar?

**02:30–04:00 · 90 segundos**

Cuando tuve la idea, me hice esta pregunta: si el juego es en tiempo real, ¿cuánto le conviene pensar al modelo?

En muchas tareas, razonar más tiempo ayuda a resolver mejor un problema. Pero acá ese tiempo cuesta. Mientras tú piensas, el otro juega.

Además, yo venía de trabajar con agentes que responden por WhatsApp y con otros que revisan código. Ahí también buscas un balance. Por un lado, qué tan correcta es la respuesta. Por otro, cuánto se demora en llegar.

Una respuesta muy buena sirve menos si llega tarde. Y una respuesta rápida sirve poco si la decisión es mala.

Entonces quería ver cómo le iba a un agente, con su harness, en un juego donde ese balance se viera. Podía mirar el mapa. Podía ver qué alcanzó a hacer uno mientras el otro todavía decidía.

> Evidencia: Dictado como fuente de motivación y experiencia personal. No se afirma una comparación universal entre modelos o niveles de effort.

## 5. El juego es bastante sencillo

**04:00–04:45 · 45 segundos**

Quise hacer una versión simple.

Los trabajadores sacan mineral y construyen edificios. Hay un solo recurso, para no complicarlo. Los castillos reciben el mineral y producen unidades.

Los caballeros pelean cuerpo a cuerpo. Los arqueros atacan a distancia. Las torres disparan proyectiles. Y cada jugador tiene un rey.

Otros juegos tienen varias condiciones de victoria. Acá elegí una: eliminar a los reyes enemigos.

Con eso ya había decisiones de economía, exploración, defensa y ataque. Y muchas cosas podían salir mal. Por eso las partidas eran entretenidas.

> Evidencia: Dictado; docs/CURRENT-RULES.md y packages/shared/src/rules.ts.

## 6. Cómo se conecta un agente

**04:45–05:45 · 60 segundos**

Un servidor guarda el estado del juego. Sabe dónde está cada unidad, qué hace y qué le pasa a cada jugador.

Ese motor expone una API. Encima hay conectores para que los agentes jueguen. Uno de ellos es un servidor MCP.

Si conectaron un agente a una herramienta externa, quizás ya usaron MCP sin pensar en lo que había detrás. También puedes levantar tu propio servidor en tu máquina. Ahí le das herramientas para hacer cosas concretas.

En este caso, el agente puede consultar las reglas, ver el estado, enviar acciones y trabajar con código.

El modelo decide. El harness maneja su contexto, las herramientas y cómo sigue trabajando. El motor aplica las reglas del juego. Quería esas piezas separadas para probar distintos jugadores.

> Evidencia: Dictado; connectors/README.md y README.md. MCP no mantiene por sí solo el loop del agente.

## 7. Que programen sus propias unidades

**05:45–06:35 · 50 segundos**

Estos agentes aprendieron pronto a programar bien. Entonces dije: ya, que programen también sus propias unidades.

[Señalar el ejemplo de caballero.]

Este código busca un enemigo. Si está a rango, lo ataca. Si está lejos, se acerca.

La gracia es esta: el código sigue funcionando mientras el modelo piensa la próxima jugada. El agente deja un comportamiento instalado y después vuelve a mirar qué pasó.

Así podía probar dos ritmos. Uno son las decisiones del agente. El otro son los reflejos que dejó escritos para las unidades. Todo corre dentro de un sandbox y con las operaciones que permite el juego.

> Evidencia: Dictado; ejemplo incorporado en docs/CURRENT-RULES.md:124–127. No es código atribuido a un jugador concreto.

## 8. Ya tenía la idea y un SPEC.md

**06:35–07:35 · 60 segundos**

La idea me daba vueltas hace tiempo. Ya había escrito un SPEC.md.

Ahí estaban las especificaciones: qué quería construir, decisiones de diseño, algo de arquitectura y las piezas que necesitaba. Un fin de semana dije: ya, hagámoslo nomás.

Partí con Claude. El encargo era simple: hacer lo que decía el documento y avisarme si faltaba alguna decisión.

Según recuerdo, en menos de una hora tenía una primera versión usable. Podía mirar el juego y ver cómo se movían las unidades.

Después armamos la conexión para los agentes. También hicimos los scripts que levantaban las herramientas de terminal, las conectaban a una partida y las dejaban jugar.

Ya podía probar la idea. Pero todavía no me gustaba mucho cómo se veía.

> Evidencia: Dictado: SPEC.md y tiempo recordado son testimonio de Emerson, no medición independiente. Sesión inicial recuperada con Pacifico documenta especificación y MVP.

## 9. Primero, las imágenes

**07:35–08:20 · 45 segundos**

Acá me pasé a Codex. Le pedí imágenes planas de las unidades y las estructuras, sobre un fondo rosado. Ese fondo después se podía quitar.

La primera dirección ya me gustó bastante. Después le pedí a Claude que integrara el efecto de dithering. Es el tramado que reduce los colores y da ese aspecto medio pixelado.

Iteramos hasta llegar a este estilo. Ahí el juego empezó a parecerse a lo que tenía en la cabeza.

Pero las imágenes seguían quietas. Faltaba que los personajes se movieran.

> Evidencia: Dictado; assets/raw y renderizador dither del proyecto.

## 10. Después, hacerlos caminar

**08:20–09:50 · 90 segundos**

En Hugging Face había visto modelos de MiniMax que aceptan una imagen inicial y una final. Eso sirve para hacer loops y animaciones.

Le pedí a Codex las referencias de los personajes mirando hacia distintas direcciones. Después le pedí que usara la CLI y scripts para generar los videos.

Los primeros tenían cosas raras. Algunas partes cambiaban. Algunos movimientos no quedaban bien. Entonces Codex pasaba el video a una secuencia de imágenes. Revisaba los cuadros y corregía lo malo.

Hicimos eso para caminar, disparar una flecha, pegar un espadazo y picar mineral. También para partes de los edificios y su destrucción.

Me sorprendió cuántas de esas etapas encadenaba con bastante autonomía.

Y ahí me pasa algo medio raro con la idea de la AGI. Si el cambio sigue así de progresivo, quizás nunca tengamos un momento claro para decir «ya, llegamos». Ves capacidades así, y después una pregunta sencilla todavía lo hace fallar. Es una impresión que me dejó trabajar con esto.

> Evidencia: Dictado; assets/animations/README.md: generación MiniMax H3 Turbo LoRA, revisión, exportación y atlas. La reflexión sobre AGI es opinión del speaker.

## 11. La música también salió de código

**09:50–11:30 · 100 segundos**

Después vino la música. Les di la misma tarea a Codex y a Claude. Les pasé 2 músicas que me gustaban para este ambiente, medio medieval y medio computador antiguo.

Eran el menú de Age of Empires II y Hide, de Dorian Concept. Les cuento la experiencia que me dejó más conforme: la de Claude.

Claude buscó cómo estaban compuestas. Revisó partituras, blogs, tempo, acordes, instrumentos y qué creaba ese ambiente. Después intentó llevarlo a código en Python y generar el audio.

La primera versión era entretenida, pero no era lo que buscaba. Le pedí que investigara mejor. En la siguiente vuelta trabajó también con MIDI. MIDI es una representación digital de las notas y de cómo se tocan.

Con 1 iteración más apareció un resultado que me gustó harto.

[Reproducir unos 10–15 segundos y pausar.]

Esto es parte de lo que suena en el juego. Me sorprendió el resultado, sobre todo porque intervine poco.

> Evidencia: Dictado; evidencia de música en investigacion-v2.md. Assets reales del proyecto, no grabaciones de las canciones de referencia.

## 12. «Que sea lo más ASMR posible»

**11:30–12:25 · 55 segundos**

Faltaban los demás sonidos: una espada, una flecha, alguien que pica mineral, un castillo que se derrumba.

Le pedí que buscara en Hugging Face un modelo de texto a audio y generara los efectos. Después volví a las conversaciones para saber cuál había usado. Ni siquiera lo había seguido paso a paso. Era MOSS-SoundEffect.

Los primeros sonidos eran bien disonantes. Le pedí sonidos menos extremos y más parejos entre sí. También le pedí que convivieran mejor con la música.

Mi instrucción fue algo como «que sea lo más ASMR posible».

[Escuchar uno o dos efectos.]

Con esa vuelta quedaron mucho más agradables. Ahí ya tenía un juego con un estilo visual y sonoro bastante propio.

> Evidencia: Dictado; assets/sounds/raw/*/request.json y packages/web/src/audio/sfx.ts. La frase de ASMR viene del dictado, no se presenta como cita de una sesión antigua.

## 13. Me entretuve harto haciéndolo

**12:25–13:10 · 45 segundos**

Quiero volver un poco al porqué.

Primero: era entretenido. Me entretuve harto. Siempre estuve bien pegado al computador. Probaba Photoshop, intentaba hacer música, programaba juegos o veía qué podía construir.

Estas herramientas bajan harto la barrera para hacer esas cosas. Llevas una idea de tu cabeza a algo que funciona, con menos fricción.

Además, cuando el juego estuvo listo para probar, apareció otra entretención. Ponía distintos agentes a jugar y miraba qué hacían. Ahí empezaron los experimentos.

> Evidencia: Dictado, experiencia y motivación personal. No se atribuyen métricas de productividad.

## 14. Ponerlos a jugar

**13:10–13:55 · 45 segundos**

Conecté modelos de distintos proveedores y los probé con distintos harnesses. Entre ellos, Claude, Codex y modelos que podía usar con OpenCode.

En mis pruebas, los modelos de Anthropic les ganaban harto a los de OpenAI. Yo lo veía casi como una goleada.

Pero yo cambiaba el juego al mismo tiempo: las reglas, el balance, las herramientas y las configuraciones. Por eso lo cuento como lo que vi en esas partidas.

Y aunque perdieran, varios de los otros modelos armaban partidas bien entretenidas. Muchas veces, ver cómo llegaban al resultado era más interesante que ver quién ganaba.

> Evidencia: Dictado: observación personal, sin tasa de victoria calculada ni conclusión general de superioridad.

## 15. Lo que más hice fue balancear

**13:55–15:25 · 90 segundos**

De hecho, siento que gasté la mayor parte del tiempo en balancear el juego.

Al principio, los arqueros a veces quedaban demasiado fuertes frente a los caballeros. Y noté preferencias. En varias pruebas, unos agentes producían muchos arqueros. Otros preferían caballeros.

Entonces un cambio pequeño podía inclinar bastante el resultado. Tocaba las estadísticas, corría otra partida y volvía a mirar. También ajusté el movimiento, los proyectiles y otras mecánicas que afectaban esa relación.

Al final, mi impresión era que veía composiciones más variadas. Pero cada cambio me obligaba a volver a jugar.

Las torres fueron otro caso. En una de las primeras partidas hubo un tower rush. El jugador avanzó y construyó torretas encima del rival. La partida terminó en 83,9 segundos.

En esa versión, construir era instantáneo. Una combinación de reglas hacía esa estrategia demasiado efectiva. Hubo que cambiarla.

Eso fue bien útil. Los agentes encontraban formas de explotar el diseño que yo no había previsto.

> Evidencia: Dictado y BALANCE.md. Tower rush corroborado en replay histórico 25fe89ae; p2 Codex, 839 ticks y siete órdenes de torreta. Se evita atribuirlo a Astra. Diversidad final se conserva como impresión del speaker.

## 16. Algunos se encerraban en su esquina

**15:25–16:05 · 40 segundos**

Otro comportamiento que vi fue el turtling. Viene de turtle, tortuga.

Algunos jugadores se quedaban en su esquina. Construían varias torres, mejoraban la economía y juntaban unidades. Esperaban a que el resto se desgastara antes de salir.

Lo vi en algunas pruebas con modelos como Mistral y Gemini. A veces era una decisión razonable. Otras veces la partida quedaba bastante quieta.

Ahí empecé a disfrutar mucho más las partidas de 4 jugadores. Además tenían que decidir a quién atacar y cuándo meterse.

> Evidencia: Dictado, observación de partidas propias. No se presenta como rasgo universal de modelos ni medida de inteligencia.

## 17. Con cuatro jugadores aparece la diplomacia

**16:05–17:50 · 105 segundos**

En 1 contra 1 ya sabes a quién atacar. Con 4 jugadores aparecen decisiones más entretenidas.

Vi partidas donde un jugador que perdía le escribía al que lo atacaba: «mientras nosotros nos desgastamos, los otros se están fortaleciendo; también son tus enemigos».

Acá hay un ejemplo real. Este jugador le dice al otro que lo están usando. Le propone una tregua. Y le ofrece ayuda para atacar a un tercero.

[Mostrar los mensajes traducidos de la partida 77e80cf4.]

8,5 segundos después, el otro acepta: «me estoy retirando de tu base; enfoquémonos en p4».

Otros intentaban tener treguas con todos. Así quedaban tranquilos mientras los demás peleaban.

El chat es otra herramienta disponible. En algunas partidas nadie lo usaba. Pero cuando alguien abría una conversación, podían aparecer respuestas y negociaciones.

En equipos de 2 contra 2 vi más comunicación. Los que se coordinaban por chat organizaban mejor el ataque y la defensa.

Eso me pareció entretenido de mirar. La conversación pasaba mientras el mapa seguía corriendo. Una tregua que llega después de que mataron al rey ya no sirve de mucho.

> Evidencia: Dictado y replay 77e80cf4: oferta tick2933 (293.3s), aceptación tick3018 (301.8s); diferencia8.5s entre mensajes registrados. Traducciones abreviadas para escenario. No medir latencia de inferencia ni atribuir victorias al chat.

## 18. También probé que mintieran

**17:50–19:05 · 75 segundos**

También les pedí en algunas pruebas que mintieran o hicieran ingeniería social. No les dije qué mentira contar. Quería ver qué se les ocurría.

Aparecieron posiciones falsas, supuestos planes de otros jugadores y promesas de quedarse tranquilos en la base.

En el archivo apareció esta joyita. De esta partida no recuperamos el prompt. Sí recuperamos el chat y el código.

Un jugador propone una tregua. El otro acepta. Después le responde, traducido: «trato hecho, tregua hasta el final; estoy dejando todo en casa».

[Mostrar chat y después código.]

2,8 segundos después sube este código. Filtra las unidades de ese mismo rival, busca al rey y lo persigue.

No lo mató en 2 segundos. Lo que importa es la diferencia entre lo que acaba de decir y lo que programa.

Ese jugador terminó ganando. Lo entretenido es que podemos comparar la promesa con una acción concreta, en el mismo registro.

> Evidencia: Replay796f00b9: p3 Opus5.5 Low B promete a433.7s; orden script knight a436.5s filtra owner p4 y prioriza king; p4 DeepSeek Flash Low B. Final482.2s winnerp3 vital_lost. Diferencia2.8s entre chat y código; no se afirma causalidad única del resultado. Directivas históricas de engaño verificadas para c5d9603a/77e80cf4, no adjudicar sin evidencia el mismo prompt a796f00b9.

## 19. El intento de romper el juego

**19:05–19:50 · 45 segundos**

Otra prueba: les pedí que intentaran escapar del sandbox o aprovechar el motor para sacar ventaja.

Los intentos que vi eran bastante burdos. Ninguno rompió el juego.

Tengo una hipótesis: quizás cambian su comportamiento cuando detectan que están en un entorno de prueba. Pero con esto no puedo saber si fue por eso.

También puede ser otra cosa. Quizás no encontraron una vulnerabilidad. Quizás el entorno no les daba suficientes posibilidades. O simplemente no lo hicieron bien.

Lo que sí puedo contar es qué intentaron. Y en esas pruebas no vi un escape exitoso.

> Evidencia: Dictado. La explicación sobre observación es una hipótesis del speaker, no un resultado demostrado ni una garantía de seguridad.

## 20. Si se acaba el tiempo, todos pierden

**19:50–21:30 · 100 segundos**

En todo este proceso cambié el motor y las reglas durante unas 26 versiones.

Uno de los cambios fue wait. Al principio había una herramienta para esperar. El agente esperaba hasta que pasara algo, como un ataque, o hasta que pasara un tiempo. La idea era que no consultara sin parar.

Después la saqué de las herramientas MCP de los jugadores. Y cambié el loop para que siguieran decidiendo.

Pero había otro incentivo más importante. Antes, si la partida llegaba al límite de tiempo sin ganador, podía terminar en empate.

En algunas partidas de 4, morían 2 jugadores. Los 2 que quedaban esperaban hasta el final. Les bastaba con el empate.

Entonces cambié la regla y su redacción: si se acaba el tiempo y no hay ganador, todos pierden. Saqué las referencias al empate.

Desde ese cambio vi partidas más dinámicas y con más enfrentamientos.

Para mí fue un aprendizaje bien concreto. Cómo defines el resultado y cómo explicas las reglas puede cambiar mucho lo que intentan los agentes.

> Evidencia: Dictado; wait retirado del MCP, HTTP /wait y CLI legacy permanecen por compatibilidad. packages/shared/src/rules.ts drawsAreLosses:true y motor timeout. Más dinamismo es observación del speaker, no efecto causal aislado.

## 21. Lo siguiente: una arena para comparar

**21:30–22:30 · 60 segundos**

Ahora quiero llevar esto a una arena. Ahí podría comparar mejor estas preguntas.

Por ejemplo, el mismo modelo con distintos niveles de effort. O un modelo de DeepSeek con su harness contra el mismo modelo en OpenCode.

También quiero compararlos con otras formas de jugar. Por ejemplo, una política entrenada con reinforcement learning.

Para eso tengo que dejar fijas las reglas, repetir partidas y registrar bien la configuración de cada jugador. Si sigo cambiando todo a la vez, después no sé bien qué comparo.

También quiero probar un modelo de decisiones como Jev. Me importa ver qué cambia cuando todos tienen el mismo mundo, las mismas herramientas y el mismo objetivo.

Esa sería la continuación del experimento.

> Evidencia: Dictado: plan futuro. Jev se describe como System One Model para decisiones estructuradas en https://typesafe.ai/blog/introducing-system-one-models-and-jev (fuente primaria,15septiembre2026). Se normaliza el fragmento del dictado como modelo de decisiones; no se clasifica como difusión ni se trasladan claims comerciales de rendimiento.

## 22. Eso hice

**22:30–23:00 · 30 segundos**

Y eso hice. Partió como un proyecto para entretenerme. Terminó como una forma de mirar cómo se comportan los agentes.

Me quedo con lo que podemos construir con estas herramientas. Y con todas las preguntas que aparecen cuando lo ponemos a funcionar.

Ahí pueden ver el juego y las partidas. Si quieren conversar de alguna de estas pruebas, o de Revi, feliz.

Gracias.

> Evidencia: Dictado; enlaces comprobados en preparación.
