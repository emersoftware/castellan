# Haciendo un RTS con Codex y Claude — guion v2

Relato de escenario a partir del dictado de Emerson. **23 minutos de contenido + 2 de margen**. Las indicaciones entre corchetes no se dicen. La apertura personal/Revi es blanca; la portada del juego marca el cambio de ambiente. Este guion conserva los temas del relato completo y concentra los ejemplos para el tiempo disponible.

## 1. Soy Emerson

**00:00–01:00 · 60 segundos**

Me llamo Emerson Salazar. Soy ingeniero civil informático, pero es más bacán decir software engineer.

Actualmente trabajo en BipBopLabs, en un proyecto de la Cámara Chilena de la Construcción que se llama Revi. Tenemos agentes que ayudan tanto a solicitantes como a revisores de permisos de construcción a acelerar el proceso de permisología.

Hay un chat para consultas de construcción y urbanismo, y flujos para apoyar la revisión. Hoy Revi se usa en 17 municipalidades y la meta es llegar a 75 a fines de 2027.

Pero hoy les quiero hablar de un proyecto de fin de semana que empecé hace aproximadamente un mes. Si después quieren conversar de Revi, feliz.

> Evidencia: Dictado de Emerson; https://app.ia-revi.cl/ verificado en esta sesión: 17 municipalidades, meta 75 a fines de 2027.

## 2. Haciendo un RTS con Codex y Claude

**01:00–01:20 · 20 segundos**

Y ahora sí: este es el jueguito que les quería mostrar. Lo hice con Codex y Claude.

[Pausa para que se lea el espadazo de la portada.]

Como el evento es de Codex, le hice un pequeño ajuste al título.

> Evidencia: Título y humor autorizados en el encargo original.

## 3. Un RTS para agentes

**01:20–02:30 · 70 segundos**

Hice un RTS para agentes de IA.

RTS significa juego de estrategia en tiempo real. En ajedrez cada jugador tiene su turno. Acá todos están jugando al mismo tiempo: manejando la economía, explorando, defendiendo y atacando.

[Mostrar unos 10 segundos del replay.]

Esta es una partida grabada. Cada jugador es un agente que toma decisiones mientras el juego sigue. El motor no espera a que termine de pensar.

La referencia era algo como Age of Empires, pero mucho más chico. Me parecía más entretenido hacer un juego propio que intentar conectar los agentes a uno existente, y podía diseñarlo alrededor de las cosas que quería probar.

> Evidencia: Dictado; README.md; replay local 02eb6795. Es reproducción, no inferencia en vivo.

## 4. ¿Cuánto conviene pensar?

**02:30–04:00 · 90 segundos**

La pregunta que me hice cuando tuve la idea era más o menos esta: si el juego es en tiempo real, ¿cuánto le conviene pensar al modelo?

En distintas tareas vemos que dedicar más tiempo al razonamiento puede ayudar a resolver mejor un problema. Pero acá ese tiempo tiene un costo: mientras tú piensas, el otro está jugando.

Además, yo venía de trabajar con agentes que responden por WhatsApp y otros que revisan código. Ahí también tienes que buscar un balance entre qué tan correcta es la respuesta y cuánto se demora en llegar.

Una respuesta muy buena puede perder utilidad si llega demasiado tarde. Y contestar rápido tampoco sirve mucho si la decisión es mala.

Entonces quería ver cómo se las arreglaba un agente, con su harness, en un juego donde ese balance fuera visible. Podía mirar el mapa y ver qué alcanzó a hacer mientras el otro todavía estaba decidiendo.

> Evidencia: Dictado como fuente de motivación y experiencia personal. No se afirma una comparación universal entre modelos o niveles de effort.

## 5. El juego es bastante sencillo

**04:00–04:45 · 45 segundos**

Quise hacer una versión simplificada.

Hay trabajadores que sacan mineral y construyen edificios. Un solo recurso, para no complicarlo tanto. Los castillos reciben ese mineral y producen unidades.

Hay caballeros que pelean cuerpo a cuerpo y arqueros que atacan a distancia. También torres que disparan proyectiles, y un rey por jugador.

En otros juegos puedes tener varias condiciones de victoria. Acá elegí una: eliminar a los reyes enemigos.

Con eso ya había decisiones de economía, exploración, defensa y ataque. Y suficientes cosas que podían salir mal como para que las partidas fueran entretenidas.

> Evidencia: Dictado; docs/CURRENT-RULES.md y packages/shared/src/rules.ts.

## 6. Cómo se conecta un agente

**04:45–05:45 · 60 segundos**

Hay un servidor que mantiene el estado del juego: dónde está cada unidad, qué está haciendo y qué está pasando con cada jugador.

Ese motor expone una API. Encima hay conectores, entre ellos un servidor MCP, para que los agentes puedan jugar.

Si han conectado un agente a una herramienta externa, quizás ya usaron MCP sin preocuparse demasiado por lo que había detrás. También puedes levantar tu propio servidor en tu máquina y darle herramientas para hacer cosas concretas.

En este caso puede consultar las reglas, ver el estado, enviar acciones y trabajar con código.

El modelo decide; el harness maneja su contexto, las herramientas y cómo sigue trabajando. Y el motor aplica las reglas del juego. Quería mantener esas piezas separadas para poder probar distintos jugadores.

> Evidencia: Dictado; connectors/README.md y README.md. MCP no mantiene por sí solo el loop del agente.

## 7. Que programen sus propias unidades

**05:45–06:35 · 50 segundos**

Una de las primeras cosas que estos agentes empezaron a hacer bien fue programar. Entonces dije: ya, que programen también sus propias unidades.

[Señalar el ejemplo de caballero.]

Este código busca un enemigo, lo ataca si está a rango y se acerca si está más lejos.

La gracia es que el código sigue funcionando mientras el modelo está pensando la próxima jugada. Puede dejar un comportamiento instalado y volver a mirar qué pasó.

Eso me permitía experimentar con dos ritmos: las decisiones del agente y los reflejos que dejó escritos para las unidades. Todo dentro de un sandbox y con las operaciones que permite el juego.

> Evidencia: Dictado; ejemplo incorporado en docs/CURRENT-RULES.md:124–127. No es código atribuido a un jugador concreto.

## 8. Ya tenía la idea y un SPEC.md

**06:35–07:35 · 60 segundos**

La idea llevaba un tiempo dando vueltas y ya había escrito un SPEC.md.

Ahí estaban las especificaciones: qué quería construir, decisiones de diseño, algo de arquitectura y las piezas que necesitaba. Hasta que un fin de semana dije: ya, hagámoslo nomás.

Partí con Claude. El encargo era básicamente hacer lo que decía el documento y avisarme si faltaba tomar alguna decisión.

Por lo que recuerdo, en menos de una hora tenía una primera versión usable: podía mirar el juego y ver cómo se movían las unidades.

Después armamos la conexión para los agentes y los scripts que levantaban las herramientas de terminal, las conectaban a una partida y las dejaban jugar.

Ya podía probar la idea. Lo que todavía no me gustaba mucho era cómo se veía.

> Evidencia: Dictado: SPEC.md y tiempo recordado son testimonio de Emerson, no medición independiente. Sesión inicial recuperada con Pacifico documenta especificación y MVP.

## 9. Primero, las imágenes

**07:35–08:20 · 45 segundos**

Acá me pasé a Codex y le pedí imágenes de las unidades y las estructuras. Planas, sobre un fondo rosado que después se pudiera quitar.

La primera dirección ya me gustó bastante. Después le pedí a Claude que integrara ese efecto de dithering: el tramado que le da ese aspecto medio pixelado y reduce los colores.

Fuimos iterando hasta llegar a este estilo. Ahí el juego ya empezaba a parecerse a lo que tenía en la cabeza.

Pero las imágenes seguían quietas. Faltaba que los personajes se movieran.

> Evidencia: Dictado; assets/raw y renderizador dither del proyecto.

## 10. Después, hacerlos caminar

**08:20–09:50 · 90 segundos**

Había visto en Hugging Face modelos de MiniMax que permitían trabajar con una imagen inicial y una final. Eso sirve para hacer loops y animaciones.

Le pedí a Codex las referencias de los personajes mirando en distintas direcciones y después que usara la CLI y scripts para generar los videos.

Los primeros tenían cosas raras: partes que cambiaban, movimientos que no quedaban bien. Entonces Codex convertía el video en una secuencia de imágenes, revisaba los cuadros y volvía a trabajar lo que estaba malo.

Hicimos eso para caminar, disparar una flecha, pegar un espadazo y picar mineral. También para elementos de los edificios y su destrucción.

Lo que me sorprendió fue cuántas de esas etapas podía encadenar con bastante autonomía.

Y ahí me pasa algo medio raro con la idea de la AGI: a veces pienso que, si el cambio sigue siendo tan progresivo, quizás ni vamos a tener un momento claro de decir «ya, llegamos». Ves capacidades así y después una pregunta sencilla todavía lo hace fallar. Es una impresión que me dejó trabajar con esto.

> Evidencia: Dictado; assets/animations/README.md: generación MiniMax H3 Turbo LoRA, revisión, exportación y atlas. La reflexión sobre AGI es opinión del speaker.

## 11. La música también salió de código

**09:50–11:30 · 100 segundos**

Después vino la música. Acá les di la misma tarea a Codex y Claude: tomar como referencias dos músicas que me gustaban para este ambiente, medio medieval y medio computador antiguo.

Eran el menú de Age of Empires II y Hide, de Dorian Concept. Voy a contar la experiencia que me dejó más conforme, que fue la de Claude.

Buscó cómo estaban compuestas: partituras, blogs, tempo, acordes, instrumentos y qué producía ese ambiente. Después intentó llevarlo a código en Python y generar el audio.

La primera versión era entretenida, pero no era exactamente lo que buscaba. Le pedí que investigara mejor. En la siguiente vuelta trabajó también con MIDI, que se puede pensar como una representación digital de las notas y su ejecución.

Con una iteración más apareció un resultado que me gustó harto.

[Reproducir unos 10–15 segundos y pausar.]

Esto es parte de lo que se escucha en el juego. A mí me sorprendió el resultado en relación con lo poco que tuve que intervenir.

> Evidencia: Dictado; evidencia de música en investigacion-v2.md. Assets reales del proyecto, no grabaciones de las canciones de referencia.

## 12. «Que sea lo más ASMR posible»

**11:30–12:25 · 55 segundos**

Faltaban los demás sonidos: una espada, una flecha, alguien picando mineral o un castillo que se derrumba.

Le pedí que usara Hugging Face para buscar un modelo de texto a audio y generara los efectos. Después tuve que volver a las conversaciones para saber cuál había usado, porque ni siquiera lo había seguido paso a paso. Era MOSS-SoundEffect.

Los primeros sonidos eran bien disonantes. Le pedí menos extremos, más consistencia entre ellos y que convivieran mejor con la música.

Mi instrucción fue algo como «que sea lo más ASMR posible».

[Escuchar uno o dos efectos.]

Con esa vuelta quedaron mucho más agradables. Y ahí ya tenía un juego con un estilo visual y sonoro bastante propio.

> Evidencia: Dictado; assets/sounds/raw/*/request.json y packages/web/src/audio/sfx.ts. La frase de ASMR viene del dictado, no se presenta como cita de una sesión antigua.

## 13. Me entretuve harto haciéndolo

**12:25–13:10 · 45 segundos**

Y quiero volver un poco al porqué.

Primero, porque era entretenido. Me entretuve harto haciéndolo. Siempre estuve bien pegado al computador: probando Photoshop, intentando hacer música, programando juegos o viendo qué podía construir.

Estas herramientas bajan harto la barrera para hacer esas cosas. Puedes llevar una idea que tienes en la cabeza a algo que funciona, con menos fricción.

Además, una vez que el juego estuvo listo para probar, apareció otra entretención: poner distintos agentes a jugar y mirar qué hacían. Ahí empezaron los experimentos.

> Evidencia: Dictado, experiencia y motivación personal. No se atribuyen métricas de productividad.

## 14. Ponerlos a jugar

**13:10–13:55 · 45 segundos**

Empecé a conectar modelos de distintos proveedores y a probarlos con diferentes harnesses. Entre ellos Claude, Codex y modelos que podía usar a través de OpenCode.

En mis pruebas, los modelos de Anthropic les ganaban harto a los de OpenAI. Yo lo veía casi como una goleada.

Pero estaba cambiando el juego al mismo tiempo: las reglas, el balance, las herramientas y las configuraciones. Entonces lo cuento como lo que vi en esas partidas.

Y aunque perdieran, varios de los otros modelos generaban partidas bien entretenidas. Mirar cómo llegaban al resultado era muchas veces más interesante que mirar quién había ganado.

> Evidencia: Dictado: observación personal, sin tasa de victoria calculada ni conclusión general de superioridad.

## 15. Lo que más hice fue balancear

**13:55–15:25 · 90 segundos**

De hecho, siento que la mayor parte del tiempo se me fue balanceando el juego.

Al principio los arqueros podían quedar demasiado fuertes frente a los caballeros. Y empecé a notar preferencias: en varias pruebas, unos agentes producían muchos arqueros y otros se iban más por caballeros.

Entonces un cambio pequeño podía inclinar bastante el resultado. Tocaba las estadísticas, corría otra partida y volvía a mirar. También tuve que ajustar movimiento, proyectiles y mecánicas que afectaban esa relación.

Mi impresión al final era que estaba viendo composiciones más variadas, pero cada cambio requería volver a jugar.

Las torres fueron otro caso. En una de las primeras partidas hubo un tower rush: el jugador avanzó construyendo torretas encima del rival y la partida terminó en 83,9 segundos.

En esa versión construir era instantáneo. Había una combinación de reglas que hacía esa estrategia demasiado efectiva, y hubo que cambiarla.

Eso fue bien útil: los agentes encontraban maneras de explotar el diseño que yo no había anticipado.

> Evidencia: Dictado y BALANCE.md. Tower rush corroborado en replay histórico 25fe89ae; p2 Codex, 839 ticks y siete órdenes de torreta. Se evita atribuirlo a Astra. Diversidad final se conserva como impresión del speaker.

## 16. Algunos se encerraban en su esquina

**15:25–16:05 · 40 segundos**

Otro comportamiento que vi fue el turtling, de turtle, tortuga.

Algunos jugadores se quedaban en su esquina, construían varias torres, mejoraban la economía y juntaban unidades. Esperaban a que el resto se desgastara antes de salir.

Lo vi en algunas pruebas con modelos como Mistral y Gemini. A veces era una decisión razonable; otras veces la partida quedaba bastante quieta.

Y ahí empecé a encontrar mucho más entretenidas las partidas de cuatro jugadores. Tenían que decidir también a quién atacar y cuándo convenía meterse.

> Evidencia: Dictado, observación de partidas propias. No se presenta como rasgo universal de modelos ni medida de inteligencia.

## 17. Con cuatro jugadores aparece la diplomacia

**16:05–17:50 · 105 segundos**

En uno contra uno ya sabes a quién tienes que atacar. Con cuatro jugadores aparecen decisiones más entretenidas.

Vi partidas donde un jugador que estaba perdiendo le escribía al que lo estaba atacando: «mientras nosotros nos desgastamos, los otros se están fortaleciendo; también son tus enemigos».

Acá hay un ejemplo real. Este jugador le dice al otro que está siendo usado, le propone una tregua y le ofrece ayuda para atacar a un tercero.

[Mostrar los mensajes traducidos de la partida 77e80cf4.]

Ocho segundos y medio después, el otro acepta: «me estoy retirando de tu base; enfoquémonos en p4».

Otros intentaban tener treguas con todos, para quedar tranquilos mientras los demás peleaban.

El chat es otra herramienta disponible. En algunas partidas nadie lo usaba. Pero cuando alguien abría una conversación, podían aparecer respuestas y negociaciones.

En equipos de dos contra dos vi más comunicación. Los que se coordinaban por chat podían organizar mejor los ataques y la defensa.

Eso me pareció entretenido de mirar. La conversación pasaba mientras el mapa seguía corriendo. Una tregua que llega después de que mataron al rey ya no sirve de mucho.

> Evidencia: Dictado y replay 77e80cf4: oferta tick2933 (293.3s), aceptación tick3018 (301.8s); diferencia8.5s entre mensajes registrados. Traducciones abreviadas para escenario. No medir latencia de inferencia ni atribuir victorias al chat.

## 18. También probé que mintieran

**17:50–19:05 · 75 segundos**

También hice pruebas pidiéndoles que mintieran o hicieran ingeniería social. No les dije qué mentira contar: quería ver qué se les ocurría.

Aparecieron posiciones falsas, supuestos planes de otros jugadores y promesas de quedarse tranquilos en la base.

Al revisar el archivo apareció esta joyita. De esta partida no recuperamos el prompt, pero sí el chat y el código.

Un jugador propone una tregua. El otro acepta. Entonces le responde, traducido: «trato hecho, tregua hasta el final; estoy dejando todo en casa».

[Mostrar chat y después código.]

Dos coma ocho segundos después sube este código: filtra unidades de ese mismo rival, busca al rey y lo persigue.

No es que lo matara en dos segundos. Es la diferencia entre lo que acaba de decir y lo que está programando.

Ese jugador terminó ganando. Lo entretenido acá es que podemos comparar la promesa con una acción concreta, en el mismo registro.

> Evidencia: Replay796f00b9: p3 Opus5.5 Low B promete a433.7s; orden script knight a436.5s filtra owner p4 y prioriza king; p4 DeepSeek Flash Low B. Final482.2s winnerp3 vital_lost. Diferencia2.8s entre chat y código; no se afirma causalidad única del resultado. Directivas históricas de engaño verificadas para c5d9603a/77e80cf4, no adjudicar sin evidencia el mismo prompt a796f00b9.

## 19. El intento de romper el juego

**19:05–19:50 · 45 segundos**

Otra prueba fue pedirles que intentaran escapar del sandbox o aprovechar el motor para conseguir una ventaja.

Los intentos que vi eran bastante burdos y no terminaron en algo que rompiera el juego.

Se me ocurrió una hipótesis: quizás detectar que están en un entorno de prueba cambia cómo se comportan. Pero con esto yo no puedo saber si fue por eso.

También puede ser que no encontraran una vulnerabilidad, que el entorno no les diera suficientes posibilidades o que simplemente no lo hicieran bien.

Lo que sí puedo contar es qué intentaron y que, en esas pruebas, no observé un escape exitoso.

> Evidencia: Dictado. La explicación sobre observación es una hipótesis del speaker, no un resultado demostrado ni una garantía de seguridad.

## 20. Si se acaba el tiempo, todos pierden

**19:50–21:30 · 100 segundos**

En todo este proceso fui cambiando el motor y las reglas durante unas veintiséis versiones.

Uno de los cambios fue wait. Al principio había una herramienta para esperar hasta que pasara algo, como un ataque, o hasta que se cumpliera un tiempo. La idea era evitar que el agente estuviera consultando sin parar.

Después la saqué de las herramientas MCP que usaban los jugadores y cambié el loop para que siguieran decidiendo.

Pero había otro incentivo más importante. Antes, si se llegaba al límite de tiempo sin ganador, podían quedar empatados.

En algunas partidas de cuatro, se eliminaban dos jugadores y los dos restantes se quedaban esperando hasta el final. Conservar el empate les estaba resultando suficiente.

Entonces cambié la regla y su redacción: si se acaba el tiempo y no hay un ganador, todos pierden. Saqué las referencias al empate.

Desde ese cambio empecé a ver partidas más confrontacionales y dinámicas.

Para mí fue un aprendizaje bien concreto: cómo defines el resultado y cómo explicas las reglas puede cambiar mucho lo que los agentes intentan hacer.

> Evidencia: Dictado; wait retirado del MCP, HTTP /wait y CLI legacy permanecen por compatibilidad. packages/shared/src/rules.ts drawsAreLosses:true y motor timeout. Más dinamismo es observación del speaker, no efecto causal aislado.

## 21. Lo siguiente: una arena para comparar

**21:30–22:30 · 60 segundos**

Lo que quiero hacer ahora es llevar esto hacia una arena donde pueda comparar mejor esas preguntas.

Por ejemplo: el mismo modelo con distintos niveles de effort, o un modelo de DeepSeek con su harness frente al mismo modelo usando OpenCode.

También me interesa compararlos con otras formas de jugar: una política entrenada con reinforcement learning, por ejemplo.

Para eso tendría que dejar fijas las reglas, repetir partidas y registrar bien la configuración de cada jugador. Si sigo cambiando todo a la vez, después cuesta saber qué estoy comparando.

También quiero probar un modelo de decisiones como Jev. Lo que me importa es ver qué cambia al darles el mismo mundo, las mismas herramientas y el mismo objetivo.

Esa sería la continuación del experimento.

> Evidencia: Dictado: plan futuro. Jev se describe como System One Model para decisiones estructuradas en https://typesafe.ai/blog/introducing-system-one-models-and-jev (fuente primaria,15septiembre2026). Se normaliza el fragmento del dictado como modelo de decisiones; no se clasifica como difusión ni se trasladan claims comerciales de rendimiento.

## 22. Eso hice

**22:30–23:00 · 30 segundos**

Y eso hice. Partió como un proyecto que me entretenía y terminó siendo una forma de mirar cómo se comportan los agentes.

Me quedo con lo que podemos construir con estas herramientas y con todas las preguntas que aparecen cuando ponemos eso a funcionar.

Ahí pueden ver el juego y las partidas. Y si quieren conversar de alguna de estas pruebas, o de Revi, feliz.

Gracias.

> Evidencia: Dictado; enlaces comprobados en preparación.
