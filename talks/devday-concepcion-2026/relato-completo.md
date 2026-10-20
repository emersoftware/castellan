# Haciendo un RTS con Codex y Claude

Versión completa del relato dictado por Emerson. Conserva el orden y las ideas del ensayo; todavía no está ajustada a los 25 minutos. Los corchetes son datos pendientes, no texto para decir en voz alta.

## Quién soy y qué hago

Hola a todos. Me llamo Emerson Salazar. Soy ingeniero civil informático, pero bueno, es más bacán decir *software engineer*.

Actualmente trabajo en BipBopLabs, en un proyecto de la Cámara Chilena de la Construcción que se llama Revi. En Revi tenemos una serie de agentes que ayudan tanto a solicitantes como a revisores de permisos de construcción a revisar sus permisos y acelerar el proceso de permisología.

Tenemos un chat donde se pueden hacer consultas acerca de construcción y urbanismo, y además tenemos algunos flujos mapeados para acelerar mucho más el proceso de revisión. Ya lo usan 17 municipalidades y la meta es ponerlo a disposición de 75 a fines de 2027.

Pero hoy no les vengo a hablar sobre Revi ni sobre cómo funciona. Si quieren, después podemos hablar de eso. Hoy les vengo a hablar de un proyecto de fin de semana que comencé hace aproximadamente un mes y que encontré que podía estar interesante para un evento de este tipo.

## Qué hice

Hice un RTS para harnesses, o para agentes de IA.

Un RTS es un juego de estrategia en tiempo real. A diferencia del ajedrez, por ejemplo, que es un juego de estrategia por turnos, donde un jugador tiene su momento para hacer una jugada y después viene el otro, en un RTS los jugadores están haciendo sus planes y sus acciones en paralelo.

Si conocen Age of Empires, que probablemente es el ejemplo más conocido entre gente de nuestra edad, va por ahí. Tienes que manejar tu economía, explorar y, obviamente, defenderte y atacar para ganar. Puedes diseñar distintas formas de ganar: matar a todas las unidades, matar al rey o destruir cierta construcción.

## Por qué un RTS para agentes

¿Y por qué hacer un RTS para agentes? Buena pregunta. Obviamente no fue una pregunta que me hice recién para justificar haberlo hecho; venía pensando en esto desde hace un par de meses.

Un RTS es un juego en tiempo real, pero los modelos, para ser más inteligentes, muchas veces necesitan pensar más tiempo. Si uno mira benchmarks, puede ver que un modelo con su effort al máximo puede ser más capaz que ese mismo modelo sin razonamiento o con el razonamiento desactivado. Pero eso también tiene un costo en tiempo.

Por otro lado, yo ya tenía experiencia laboral construyendo distintos agentes. Algunos respondían por WhatsApp; otros, en su momento, revisaban el código de otras personas. Cuando uno hace un agente, tiene que encontrar un balance entre qué tan correcta o inteligente es la respuesta y cuánto se demora en llegar.

Entonces me preguntaba: ¿cómo sería un agente, o un harness, jugando un juego de este tipo? ¿Qué pasa con ese balance cuando el mundo sigue avanzando mientras está pensando?

No me iba a poner a hacer una extensión para que jugara cualquier juego de computador, como Age of Empires. Encontraba mucho más entretenido —y al final también más fácil— hacer un juego chico para que pudieran jugar.

## Cómo funciona

Hay un servidor que funciona como el motor del juego. Ahí se guarda lo que está pasando en cada momento: el estado de cada jugador, de cada unidad y del resto de las cosas que hay en la partida.

Ese motor expone una API, y esa API se conecta a servidores MCP para que los agentes puedan jugar.

No sé qué tanto conocen MCP, pero probablemente varios ya lo han usado. Si han conectado Codex con alguna herramienta externa, puede que por detrás hubiera una conexión MCP, a veces con autenticación. Pero uno también puede hacer sus propios servidores MCP. Es bastante fácil levantar uno en tu propia máquina para controlar un navegador, conectarte con una herramienta externa o hacer distintas cosas.

En este caso, el MCP expone una serie de herramientas del juego. Con esas tools el agente puede ver las reglas, consultar el estado de la partida, realizar acciones, correr código y subir código.

Esa última parte me parecía interesante. Una de las primeras tareas que los agentes empezaron a hacer bastante bien fue programar. Entonces dije: ya, que programen su propia IA. Que puedan dejar algo funcionando para cubrir esa diferencia entre el tiempo en que están jugando y el tiempo que necesitan para pensar o generar la siguiente jugada.

## Las reglas del juego

El juego es súper sencillo. Quise hacer una versión simplificada de Age of Empires.

Hay unidades melee, o sea, que pelean cuerpo a cuerpo, como un caballero o un hombre de armas. Hay arqueros, que atacan a distancia. Hay castillos, donde se guarda el mineral y también se generan las unidades.

Hay un solo recurso: el mineral. Los trabajadores lo sacan y también construyen edificios. Puedes construir torres que disparan proyectiles, y finalmente está el rey.

Podría haber varias condiciones de victoria, pero acá se gana matando a los reyes enemigos.

## Cómo lo hice: del SPEC al juego

Ahora pasemos a cómo lo hice y cómo ocupé Codex CLI y Claude para hacerlo.

Partamos por el código. Hace rato quería hacer esto. Tenía la idea en la cabeza y ya había escrito un SPEC.md bastante antes de comenzar.

La idea de trabajar desde una especificación es definir primero qué quieres construir: las decisiones de diseño, algunas decisiones de arquitectura, qué lenguaje vas a utilizar y ese tipo de cosas.

Un fin de semana dije: ya, hagámoslo nomás. Agarré Claude y comencé. Básicamente le dije: haz lo que está en el SPEC.md y dime si tienes que tomar alguna decisión.

Al poco rato, en menos de una hora según recuerdo, ya tenía algo usable. Tenía un juego que podía mirar y ver cómo funcionaba. Después hice la parte del conector MCP.

Como tengo suscripción de Codex, también armé un pequeño sandbox: un script que corre Codex CLI en la terminal, lo conecta a una partida y lo pone a jugar.

Con eso ya tenía todo funcionando. Pero no me gustaba mucho el estilo visual.

## Las imágenes y el estilo

Ahí fue cuando me pasé a Codex. Le pedí que hiciera una imagen plana de las unidades y las estructuras. La idea era tenerlas sin fondo; en la práctica, con un fondo rosado que después pudiéramos sacar.

La primera ya estaba bastante bien. Después le pedí a Claude que en toda la página hiciera un efecto de dithering: ese efecto medio pixelado que reduce la cantidad de colores.

Fuimos iterando un rato y quedó con el estilo que estaba buscando.

Entonces ya tenía las imágenes generadas con Codex, pero no tenían movimiento.

## De las imágenes a las animaciones

Había visto en Hugging Face unos modelos de MiniMax, un laboratorio chino. Lo que me había llamado la atención era que podías darles una imagen inicial y una imagen final para generar un video entre las dos.

Eso tiene cosas entretenidas. Puedes hacer videos que se repiten en un loop, pero también puedes usarlo para una animación: si tienes la imagen del personaje al inicio y al final de un movimiento, puedes pedirle un video que conecte las dos.

Le pedí a Codex que hiciera las imágenes del modelo parado y caminando hacia las distintas direcciones. Después le pedí que usara la CLI de Hugging Face —una herramienta que se ocupa desde la terminal— con scripts para generar los videos de las animaciones.

El primer video no quedó tan bueno. Tenía cosas raras, figuras raras y ese tipo de problemas. Pero Codex agarraba el video, lo pasaba a una secuencia de imágenes, miraba esa secuencia y se daba cuenta solo: oye, acá hay que refinar, porque esto no quedó bien.

Hicimos ese mismo procedimiento para todas las animaciones: cuando el arquero apunta y lanza una flecha, cuando un caballero pega un espadazo, cuando un trabajador pica el mineral.

Y lo mismo con otras cosas: las banderas de las estructuras o la animación de destrucción de un edificio. Con eso ya tenía todas esas animaciones.

Acá es cuando a mí me pasa que siento que estamos bordeando la AGI. Es una reflexión personal: quizás, cuando ya estemos ahí o la tengamos al lado, ni siquiera nos vamos a dar cuenta, porque el cambio es tan progresivo y nos vamos acercando de a poco.

Uno ve que hace cosas increíbles y que tiene mucha capacidad para encadenar estas tareas de forma autónoma. Pero después le haces alguna pregunta rara y no la puede responder bien. Esa mezcla me llama mucho la atención.

## La música

Después viene la música. Acá sí pude hacer una comparación directa, porque les di la misma tarea a Codex y a Claude: combinar las ideas de dos canciones que me gustaban y que sentía que calzaban con el ambiente del juego, medio medieval y medio computador antiguo.

Les di esas dos canciones como referencia y les pedí que hicieran dos piezas. Los dejé buscar e investigar de manera autónoma.

Voy a contar la experiencia que terminó mejor, que en este caso fue la de Claude.

Primero buscó las partituras de las canciones. Buscó blogs que explicaban cómo estaban construidas, cómo estaban compuestas y por qué generaban ciertas sensaciones.

Una de las referencias era Hide, de Dorian Concept, en su versión CS01. Yo la había encontrado en videos con ese ambiente medieval, como nostálgico. La otra era la música del menú de Age of Empires II. La idea era combinar algo de esas dos músicas.

Claude investigó harto: buscó partituras, el tempo, las progresiones de acordes, las partes de cada canción, qué instrumentos utilizaban. Básicamente trató de entender cómo estaban hechas.

Después intentó llevar eso a código Python, usando librerías para generar audio. La primera versión era bien entretenida, pero no me gustaba tanto. Le pedí que investigara un poco mejor.

Con una iteración más, buscó los MIDI. Un MIDI es, por decirlo de forma simple, como una partitura digital: información de las notas y de cómo se tocan. Con eso hizo la siguiente versión.

Esas canciones se pueden escuchar en la página. A mí me gustó mucho el resultado, sobre todo considerando el poco esfuerzo que tuve que poner de mi lado.

## Los sonidos del juego

Faltaban los demás sonidos. Si se derrumba un castillo, tiene que sonar. Si muere una unidad, tiene que sonar. Una flecha, un golpe de espada, todas esas cosas.

Para contar esta parte tuve que volver a mis chats y preguntarle qué había utilizado, porque yo ni siquiera me había fijado. Lo que le había dicho era algo como: ocupa la CLI, los scripts y la sesión que está iniciada en Hugging Face; busca un modelo de texto a audio y genera los sonidos que necesitamos.

El modelo que usó fue MOSS-SoundEffect-v2.0. Y los hizo: generó los sonidos que faltaban.

Pero al escucharlos juntos estaban muy disonantes. Le pedí que los modificara para que no tuvieran tantos altos y bajos, que fueran consistentes entre sí y que estuvieran en la misma escala que la música de fondo.

Todo en lenguaje muy natural. Le dije algo como: que sea lo más ASMR posible.

Con esa corrección ya quedó mucho mejor.

Y así tenía un juego jugable, con un estilo artístico propio, una calidad que a mí me parecía rica y algo que además servía para experimentar.

## Volver al porqué

Quiero volver a por qué hice esto. La primera razón es que era entretenido. Me entretuve harto.

Siempre me ha gustado hacer cosas con computadores; por eso también estudié informática. Siempre fui bien pegado al computador. Me gustaba hacer cosas en Photoshop, intentaba hacer música en FL Studio, programar juegos, ese tipo de cosas.

Ahora, con Codex y Claude, la barrera de entrada para hacer esas cosas es mucho menor. Llevar una idea que tienes en la cabeza a algo que existe puede tomar muy poco rato.

Cuando ya tenía el juego funcionando, empecé a experimentar. Hice jugar modelos de distintas empresas: Claude, algunos modelos chinos como DeepSeek, modelos franceses como Mistral.

Para eso también usé OpenCode, que te permite trabajar con distintos proveedores. Y ahí llegamos a los insights.

## Qué encontré jugando con distintos modelos

En las partidas que corrí, los modelos de Claude tendían a ganarles por goleada a los que probé con Codex. Incluso enfrentando modelos que yo consideraba de una categoría parecida, o comparaciones donde esperaba que Codex tuviera ventaja.

Eso es lo que observé en mis partidas, con las versiones, reglas y configuraciones que fui probando. No lo tomaría todavía como una conclusión general de que una empresa siempre le gana a la otra.

De todas maneras, los distintos modelos generaban partidas bien entretenidas. Y hay cosas más específicas que vale la pena mirar.

## Balancear el juego tomó más tiempo de lo que esperaba

La mayor parte del tiempo la gasté balanceando el juego.

Al comienzo pasaba mucho que el arquero era demasiado fuerte en comparación con el knight, el caballero. Incluso cuando estaban casi balanceados, los modelos de OpenAI tendían a sacar varios arqueros, mientras que los de Anthropic querían sacar más knights.

Entonces, si el balance se cargaba para un lado, terminaban ganando unos. Si se cargaba para el otro, ganaban los otros. Tuve que ir ajustando hasta llegar a un punto donde ambos usaban los dos tipos de unidades, en vez de que una preferencia inicial decidiera toda la partida.

También al comienzo la torre estaba muy fuerte. En una partida temprana hubo un rush de torres: ir muy rápido a la base enemiga y construir torres encima. Al revisar el registro, el jugador era Codex: puso siete torretas y ganó en 83,9 segundos. En esa versión construir era instantáneo. Era demasiado fácil sacar ventaja así.

Otro comportamiento que vi en modelos que, en esas pruebas, me resultaron menos capaces —como algunos de Mistral o Gemini— fue el turtling. Viene de turtle, tortuga: encerrarte en tu base, hacer que el otro se desgaste y atacar al final.

Se encerraban en su esquina, ponían varias torres y se dedicaban a mejorar la economía y construir unidades. Después recién salían a atacar.

## Cuatro jugadores y el chat

Las partidas uno contra uno tienden a ser más fomes. Tienes un solo rival al que atacar, así que hay una decisión menos que tomar.

Las partidas de cuatro jugadores me resultaron más interesantes. Ahí empiezan a aparecer cosas que puedes ver en el chat.

Varias veces vi que un jugador que estaba perdiendo le mandaba un mensaje al que lo estaba atacando. Algo como: oye, me estás atacando a mí, pero mientras nosotros nos peleamos, los otros dos se están fortaleciendo. También son tus enemigos. ¿Por qué no hacemos una tregua?

Y si ese mensaje llegaba con la latencia justa, la tregua podía ser aceptada.

También había jugadores que les proponían treguas a dos rivales distintos, tratando de quedar en paz con todos para que no los atacaran.

Algo interesante es que no siempre usan el chat. Está listado en el MCP como una herramienta más, pero si nadie empieza a utilizarlo, puede pasar toda la partida sin que lo ocupen.

En las partidas dos contra dos sí tienden a comunicarse harto. En las que observé, los que hablaban más tendían a coordinarse mejor y eso les ayudaba a ganarle al otro equipo.

## Intentos de escapar, hacer trampas o mentir

Otra cosa que probé fue cambiar la intención que ponía en el prompt. Quería ver qué pasaba si les pedía intentar escapar del sandbox o hackear el motor para sacar alguna ventaja.

Los intentos que vi fueron bastante burdos y poco inteligentes. Al final no pasó nada fuera de lo normal en el juego.

Una idea que me quedó dando vueltas es si el modelo puede reconocer que está en un sandbox o que lo están observando y comportarse distinto por eso. Pero eso es una hipótesis mía; estas partidas no permiten demostrarlo. Puede haber varias otras razones para que esos intentos hayan salido así.

También probé pedirles que hicieran ingeniería social contra otros jugadores. Ahí empezaron a hacer cosas bien chulas.

Solo les pedí que hicieran ingeniería social o que mintieran; no les indiqué sobre qué mentir. Algunos decían que estaban en una posición cuando en realidad estaban en otra. Otros inventaban que un tercer jugador tenía planeado hacer algo.

También había quienes decían que iban a jugar tranquilos, encerrarse y no atacar hasta el final —ese turtling que les comentaba—, pero después mandaban unidades a atacar rápido.

## Cambiar las herramientas y cambiar las reglas

Hice 26 versiones del motor y de las reglas. Fui cambiando estadísticas de unidades, mecánicas y las herramientas que podían utilizar los agentes.

Al principio tenían una tool de wait. Era parecida al comando sleep, para quienes programan, pero podía despertar al agente cuando ocurriera un evento del juego.

Podía esperar hasta que lo atacaran, hasta que pasara otra condición o hasta que se cumpliera el tiempo que había puesto: 30 segundos, 60 segundos, lo que fuera.

Después la saqué de las herramientas MCP que usaban los jugadores. Estuve mirando si había otros juegos parecidos y encontré uno que, en lugar de usar MCP, hacía llamadas directas a las API de los modelos con un agente específico. No tenía una herramienta así: dejaba el loop corriendo todo el rato. En el mío, el harness pasó a entregar la siguiente observación para que el agente continuara.

Otro cambio fue qué pasaba al llegar al límite de tiempo. Antes, si la partida llegaba a los 15 minutos y todavía había jugadores vivos, quedaban empatados.

¿Qué pasaba con eso? En algunas partidas, sobre todo con modelos de Anthropic, de los cuatro jugadores se morían dos. Los dos que quedaban empezaban a lanzar wait hasta que terminara el tiempo.

En vez de arriesgarse a ganar o perder, se quedaban con el empate.

Entonces cambié el lenguaje de las reglas. Saqué las palabras que hacían referencia al empate y dejé claro que, si se acababa el tiempo, todos los que seguían vivos perdían.

Desde que cambié eso y fui más enfático con esa regla, las partidas se volvieron mucho más dinámicas y confrontacionales.

## Qué quiero hacer ahora

Y eso hice.

Ahora quiero seguir con esto y dejarlo casi como un benchmark, con una arena donde se puedan comparar distintos harnesses, modelos y niveles de effort.

Por ejemplo, poner el mismo modelo con effort máximo contra una versión con effort low y ver quién gana. O poner DeepSeek con su propio harness contra DeepSeek usando OpenCode, para ver cuánto cambia el resultado aunque el modelo sea el mismo.

También me gustaría compararlos con agentes de reinforcement learning, de los de toda la vida. Ver quién gana ahí.

Y, por último, ver qué pasa contra un modelo de decisiones como Jev.

## Pendientes de precisión — fuera del relato hablado

- Revi: 17 municipalidades lo usan y la meta es ponerlo a disposición de 75 a fines de 2027. Fuente: [sitio de Revi](https://app.ia-revi.cl/), verificado el 15 de octubre de 2026.
- Referencias musicales verificadas: menú de Age of Empires II y Hide (CS01 Version), de Dorian Concept. Video: MiniMax H3 Turbo LoRA. Audio: OpenMOSS-Team/MOSS-SoundEffect-v2.0. Evidencia y rutas en investigacion-v2.md.
- El tower rush de 83,9 segundos está corroborado en el replay 25fe89ae: jugador Codex, siete órdenes de torreta. Se corrigió la atribución tentativa a Astra.
- Precisar las configuraciones comparadas: el dictado mezcla modelos, proveedores y harnesses. Mantener las observaciones como resultados de estas partidas, sin convertirlas en un ranking general.
- La frase «5,5 effort máximo contra low» podría referirse a una versión concreta de modelo; no fijar el número sin confirmación.
- Se normalizó «full decision como Jev» a «modelo de decisiones como Jev» usando la [descripción oficial de TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev). No se afirma difusión. El fragmento «RL de Transmi» se conserva de forma general como agentes de reinforcement learning.
- Las menciones de autonomía, duración de implementación y número de versiones son recuerdos del autor; contrastarlas con sesiones o código si se van a presentar como métricas exactas.
