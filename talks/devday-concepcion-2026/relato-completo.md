# Haciendo un RTS con Codex y Claude

Versión completa del relato que dictó Emerson. Conserva el orden y las ideas del ensayo. Todavía no está ajustada a los 25 minutos. Los corchetes son datos pendientes, no texto para decir en voz alta.

## Quién soy y qué hago

Hola a todos. Me llamo Emerson Salazar. Soy ingeniero civil informático, pero bueno, es más bacán decir *software engineer*.

Trabajo en BipBopLabs. Estoy en Revi, un proyecto de la Cámara Chilena de la Construcción. En Revi tenemos varios agentes que ayudan con los permisos de construcción. Ayudan a quienes piden el permiso y a quienes lo revisan. Así el proceso de permisología avanza más rápido.

Tenemos un chat para hacer consultas de construcción y urbanismo. También tenemos algunos flujos mapeados que aceleran mucho más la revisión. Ya lo usan 17 municipalidades. La meta es ponerlo a disposición de 75 a fines de 2027.

Pero hoy no les vengo a hablar de Revi ni de cómo funciona. Si quieren, después conversamos de eso. Hoy les vengo a hablar de un proyecto de fin de semana. Lo comencé hace más o menos un mes. Me pareció interesante para un evento como este.

## Qué hice

Hice un RTS para harnesses, o para agentes de IA.

Un RTS es un juego de estrategia en tiempo real. El ajedrez, en cambio, es un juego de estrategia por turnos. Ahí un jugador hace su jugada y después viene el otro. En un RTS los jugadores hacen sus planes y sus acciones en paralelo.

Si conocen Age of Empires, va por ahí. Probablemente es el ejemplo más conocido para gente de nuestra edad. Tienes que manejar tu economía, explorar y, obviamente, defenderte y atacar para ganar. Puedes diseñar distintas formas de ganar: matar a todas las unidades, matar al rey o destruir cierta construcción.

## Por qué un RTS para agentes

¿Y por qué un RTS para agentes? Buena pregunta. No me la hice recién para justificarlo. Venía pensando en esto hace un par de meses.

Un RTS es un juego en tiempo real. Pero los modelos muchas veces necesitan pensar más tiempo para ser más inteligentes. En los benchmarks, un modelo con su effort al máximo puede ser más capaz que el mismo modelo sin razonamiento. Pero eso también cuesta tiempo.

Además, yo ya había construido varios agentes en mi trabajo. Algunos respondían por WhatsApp. Otros, en su momento, revisaban el código de otras personas. Cuando haces un agente, buscas un balance. Por un lado, qué tan correcta o inteligente es la respuesta. Por otro, cuánto se demora en llegar.

Entonces me preguntaba: ¿cómo jugaría un agente, o un harness, un juego de este tipo? ¿Qué pasa con ese balance cuando el mundo sigue avanzando mientras piensa?

No iba a hacer una extensión para que jugara cualquier juego de computador, como Age of Empires. Me parecía mucho más entretenido hacer un juego chico para ellos. Y al final también era más fácil.

## Cómo funciona

Un servidor funciona como motor del juego. Ahí se guarda lo que pasa en cada momento: el estado de cada jugador, de cada unidad y del resto de la partida.

Ese motor expone una API. Esa API se conecta a servidores MCP para que los agentes puedan jugar.

No sé qué tanto conocen MCP, pero varios probablemente ya lo usaron. Si conectaron Codex con alguna herramienta externa, quizás había una conexión MCP detrás, a veces con autenticación. Pero también puedes hacer tus propios servidores MCP. Es bastante fácil levantar uno en tu máquina. Sirve para controlar un navegador, conectarte con una herramienta externa o hacer otras cosas.

En este caso, el MCP expone varias herramientas del juego. Con esas tools el agente ve las reglas, consulta el estado de la partida, hace acciones, corre código y sube código.

Esa última parte me parecía interesante. Los agentes aprendieron pronto a programar bastante bien. Entonces dije: ya, que programen su propia IA. Que dejen algo funcionando mientras piensan. Así cubren la diferencia entre el tiempo de juego y el tiempo que necesitan para la siguiente jugada.

## Las reglas del juego

El juego es súper sencillo. Quise hacer una versión simple de Age of Empires.

Hay unidades melee, o sea, que pelean cuerpo a cuerpo, como un caballero o un hombre de armas. Hay arqueros, que atacan a distancia. Hay castillos. Ahí se guarda el mineral y se generan las unidades.

Hay un solo recurso: el mineral. Los trabajadores lo sacan y también construyen edificios. Puedes construir torres que disparan proyectiles. Y finalmente está el rey.

Podría haber varias condiciones de victoria. Acá ganas si matas a los reyes enemigos.

## Cómo lo hice: del SPEC al juego

Ahora les cuento cómo lo hice y cómo usé Codex CLI y Claude.

Partamos por el código. Hace rato quería hacer esto. Tenía la idea en la cabeza. Y había escrito un SPEC.md bastante antes de comenzar.

Trabajar desde una especificación significa definir primero qué quieres construir. Ahí van las decisiones de diseño, algunas decisiones de arquitectura, el lenguaje que vas a usar y ese tipo de cosas.

Un fin de semana dije: ya, hagámoslo nomás. Agarré Claude y comencé. Le dije más o menos esto: haz lo que está en el SPEC.md y dime si tienes que tomar alguna decisión.

Al poco rato ya tenía algo usable. Según recuerdo, fue en menos de una hora. Tenía un juego que podía mirar y ver cómo funcionaba. Después hice la parte del conector MCP.

Tengo suscripción de Codex. Así que también armé un pequeño sandbox: un script que corre Codex CLI en la terminal, lo conecta a una partida y lo pone a jugar.

Con eso ya funcionaba todo. Pero no me gustaba mucho el estilo visual.

## Las imágenes y el estilo

Ahí me pasé a Codex. Le pedí una imagen plana de las unidades y las estructuras. La idea era tenerlas sin fondo. En la práctica, usamos un fondo rosado que después pudiéramos sacar.

La primera ya estaba bastante bien. Después le pedí a Claude un efecto de dithering en toda la página. Es ese efecto medio pixelado que reduce la cantidad de colores.

Iteramos un rato y quedó con el estilo que buscaba.

Ya tenía las imágenes que hizo Codex. Pero no tenían movimiento.

## De las imágenes a las animaciones

En Hugging Face había visto unos modelos de MiniMax, un laboratorio chino. Me llamó la atención algo: les das una imagen inicial y una final, y generan un video entre las dos.

Eso tiene cosas entretenidas. Puedes hacer videos que se repiten en loop. Y también puedes hacer una animación. Si tienes la imagen del personaje al inicio y al final de un movimiento, le pides un video que conecte las dos.

Le pedí a Codex las imágenes del modelo parado y caminando hacia las distintas direcciones. Después le pedí que generara los videos de las animaciones con scripts y la CLI de Hugging Face. La CLI es una herramienta que usas desde la terminal.

El primer video no quedó tan bueno. Tenía cosas raras, figuras raras y ese tipo de problemas. Pero Codex agarraba el video y lo pasaba a una secuencia de imágenes. Miraba esa secuencia y se daba cuenta solo: oye, acá hay que refinar, porque esto no quedó bien.

Hicimos lo mismo para todas las animaciones: cuando el arquero apunta y lanza una flecha, cuando un caballero pega un espadazo, cuando un trabajador pica el mineral.

Y lo mismo con otras cosas: las banderas de las estructuras o la destrucción de un edificio. Con eso ya tenía todas las animaciones.

Acá siento que estamos bordeando la AGI. Es una reflexión personal. Quizás, cuando ya estemos ahí o la tengamos al lado, ni nos vamos a dar cuenta. El cambio es tan progresivo que nos acercamos de a poco.

Ves que hace cosas increíbles y que encadena estas tareas con mucha autonomía. Pero después le haces una pregunta rara y no la responde bien. Esa mezcla me llama mucho la atención.

## La música

Después viene la música. Acá sí pude comparar directo, porque les di la misma tarea a Codex y a Claude. Tenían que combinar las ideas de 2 canciones que me gustaban. Sentía que calzaban con el ambiente del juego, medio medieval y medio computador antiguo.

Les di esas 2 canciones como referencia y les pedí 2 piezas. Los dejé buscar e investigar solos.

Les cuento la experiencia que terminó mejor. En este caso fue la de Claude.

Primero buscó las partituras de las canciones. También buscó blogs que explicaban cómo estaban construidas, cómo estaban compuestas y por qué generaban ciertas sensaciones.

Una referencia era Hide, de Dorian Concept, en su versión CS01. Yo la había encontrado en videos con ese ambiente medieval, como nostálgico. La otra era la música del menú de Age of Empires II. La idea era combinar algo de las 2.

Claude investigó harto. Buscó partituras, el tempo, las progresiones de acordes, las partes de cada canción y los instrumentos. Básicamente trató de entender cómo estaban hechas.

Después intentó llevar eso a código Python, con librerías para generar audio. La primera versión era bien entretenida, pero no me gustaba tanto. Le pedí que investigara un poco mejor.

En la siguiente iteración buscó los MIDI. Un MIDI es como una partitura digital: guarda las notas y cómo se tocan. Con eso hizo la siguiente versión.

Esas canciones suenan en la página. Me gustó mucho el resultado, sobre todo por el poco esfuerzo que puse de mi lado.

## Los sonidos del juego

Faltaban los demás sonidos. Si se derrumba un castillo, tiene que sonar. Si muere una unidad, tiene que sonar. Una flecha, un golpe de espada, todas esas cosas.

Para contar esta parte, volví a mis chats y le pregunté qué había usado. Yo ni me había fijado. Le había dicho algo como: ocupa la CLI, los scripts y la sesión que está iniciada en Hugging Face; busca un modelo de texto a audio y genera los sonidos que necesitamos.

Usó el modelo MOSS-SoundEffect-v2.0. Y generó los sonidos que faltaban.

Pero juntos sonaban muy disonantes. Le pedí que los cambiara. Quería menos altos y bajos, sonidos parejos entre sí y en la misma escala que la música de fondo.

Todo en lenguaje muy natural. Le dije algo como: que sea lo más ASMR posible.

Con esa corrección quedó mucho mejor.

Así tenía un juego jugable, con un estilo artístico propio y una calidad que me parecía rica. Y además servía para experimentar.

## Volver al porqué

Quiero volver a por qué hice esto. La primera razón: era entretenido. Me entretuve harto.

Siempre me gustó hacer cosas con computadores. Por eso estudié informática. Siempre fui bien pegado al computador. Hacía cosas en Photoshop, intentaba hacer música en FL Studio, programaba juegos, ese tipo de cosas.

Ahora, con Codex y Claude, la barrera de entrada para hacer esas cosas es mucho menor. Llevar una idea de tu cabeza a algo que existe puede tomar muy poco rato.

Cuando el juego ya funcionaba, empecé a experimentar. Puse a jugar modelos de distintas empresas: Claude, algunos modelos chinos como DeepSeek, modelos franceses como Mistral.

Para eso también usé OpenCode, que te permite trabajar con distintos proveedores. Y ahí llegamos a los insights.

## Qué encontré jugando con distintos modelos

En mis partidas, los modelos de Claude tendían a ganarles por goleada a los que probé con Codex. Pasaba incluso contra modelos que yo consideraba de una categoría parecida. Y en comparaciones donde esperaba ventaja de Codex.

Eso observé en mis partidas, con las versiones, reglas y configuraciones que fui probando. Todavía no lo tomaría como una conclusión general de que una empresa siempre le gana a la otra.

De todas maneras, los distintos modelos armaban partidas bien entretenidas. Y hay cosas más específicas que vale la pena mirar.

## Balancear el juego tomó más tiempo de lo que esperaba

Gasté la mayor parte del tiempo en balancear el juego.

Al comienzo, el arquero muchas veces era demasiado fuerte frente al knight, el caballero. Incluso con las unidades casi balanceadas, los modelos de OpenAI tendían a sacar varios arqueros. Los de Anthropic querían sacar más knights.

Entonces, si el balance se cargaba para un lado, ganaban unos. Si se cargaba para el otro, ganaban los otros. Fui ajustando hasta que ambos usaron los 2 tipos de unidades. Así una preferencia inicial ya no decidía toda la partida.

Al comienzo la torre también era muy fuerte. En una partida temprana hubo un rush de torres. Es ir muy rápido a la base enemiga y construir torres encima. Revisé el registro y el jugador era Codex. Puso 7 torretas y ganó en 83,9 segundos. En esa versión construir era instantáneo. Era demasiado fácil sacar ventaja así.

Vi otro comportamiento en modelos que, en esas pruebas, me parecieron menos capaces, como algunos de Mistral o Gemini. Es el turtling. Viene de turtle, tortuga: te encierras en tu base, dejas que el otro se desgaste y atacas al final.

Se encerraban en su esquina y ponían varias torres. Mejoraban la economía y construían unidades. Recién después salían a atacar.

## Cuatro jugadores y el chat

Las partidas 1 contra 1 tienden a ser más fomes. Tienes un solo rival para atacar, así que tomas una decisión menos.

Las partidas de 4 jugadores me resultaron más interesantes. Ahí empiezan a aparecer cosas en el chat.

Varias veces vi que un jugador que perdía le mandaba un mensaje al que lo atacaba. Algo como: oye, me estás atacando a mí, pero mientras nosotros nos peleamos, los otros dos se están fortaleciendo. También son tus enemigos. ¿Por qué no hacemos una tregua?

Y si ese mensaje llegaba con la latencia justa, el otro podía aceptar la tregua.

Algunos jugadores también proponían treguas a 2 rivales distintos. Buscaban quedar en paz con todos para que no los atacaran.

Algo interesante: no siempre usan el chat. Está en el MCP como una herramienta más. Pero si nadie empieza a usarlo, puede pasar toda la partida sin que lo ocupen.

En las partidas 2 contra 2 sí tienden a comunicarse harto. En las que observé, los que hablaban más se coordinaban mejor. Eso les ayudaba a ganarle al otro equipo.

## Intentos de escapar, hacer trampas o mentir

También probé cambiar la intención del prompt. Quería ver qué pasaba si les pedía escapar del sandbox o hackear el motor para sacar ventaja.

Los intentos que vi fueron bastante burdos y poco inteligentes. Al final no pasó nada fuera de lo normal en el juego.

Me quedó una idea dando vueltas. Quizás el modelo reconoce que está en un sandbox o que lo observan, y por eso se comporta distinto. Pero es una hipótesis mía. Estas partidas no permiten demostrarla. Esos intentos pueden haber salido así por varias otras razones.

También les pedí ingeniería social contra otros jugadores. Ahí empezaron a hacer cosas bien chulas.

Solo les pedí ingeniería social o que mintieran. No les dije sobre qué mentir. Algunos decían que estaban en una posición, pero estaban en otra. Otros inventaban que un tercer jugador planeaba algo.

Otros decían que iban a jugar tranquilos, encerrarse y no atacar hasta el final. Es el turtling que les comentaba. Pero después mandaban unidades a atacar rápido.

## Cambiar las herramientas y cambiar las reglas

Hice 26 versiones del motor y de las reglas. Cambié estadísticas de unidades, mecánicas y las herramientas que usaban los agentes.

Al principio tenían una tool de wait. Para quienes programan, era parecida al comando sleep. Pero podía despertar al agente cuando ocurría un evento del juego.

El agente podía esperar hasta que lo atacaran o hasta otra condición. También podía esperar el tiempo que había puesto: 30 segundos, 60 segundos, lo que fuera.

Después la saqué de las herramientas MCP de los jugadores. Busqué otros juegos parecidos. Encontré uno que no usaba MCP. Llamaba directo a las API de los modelos con un agente específico. No tenía una herramienta así: dejaba el loop corriendo todo el rato. En el mío, el harness pasó a entregar la siguiente observación para que el agente continuara.

Otro cambio fue qué pasaba al llegar al límite de tiempo. Antes, si la partida llegaba a los 15 minutos con jugadores vivos, quedaban empatados.

¿Qué pasaba con eso? En algunas partidas, sobre todo con modelos de Anthropic, morían 2 de los 4 jugadores. Los 2 que quedaban empezaban a lanzar wait hasta que terminara el tiempo.

No se arriesgaban a ganar o perder. Se quedaban con el empate.

Entonces cambié el lenguaje de las reglas. Saqué las palabras sobre el empate. Dejé claro que, si se acababa el tiempo, todos los que seguían vivos perdían.

Desde ese cambio, y con una regla más enfática, las partidas fueron mucho más dinámicas y con más enfrentamientos.

## Qué quiero hacer ahora

Y eso hice.

Ahora quiero seguir y dejarlo casi como un benchmark. Una arena para comparar distintos harnesses, modelos y niveles de effort.

Por ejemplo, el mismo modelo con effort máximo contra una versión con effort low, para ver quién gana. O DeepSeek con su propio harness contra DeepSeek en OpenCode. Así veo cuánto cambia el resultado con el mismo modelo.

También me gustaría compararlos con agentes de reinforcement learning, de los de toda la vida. Ver quién gana ahí.

Y por último, ver qué pasa contra un modelo de decisiones como Jev.

## Pendientes de precisión — fuera del relato hablado

- Revi: 17 municipalidades lo usan y la meta es ponerlo a disposición de 75 a fines de 2027. Fuente: [sitio de Revi](https://app.ia-revi.cl/), verificado el 15 de octubre de 2026.
- Referencias musicales verificadas: menú de Age of Empires II y Hide (CS01 Version), de Dorian Concept. Video: MiniMax H3 Turbo LoRA. Audio: OpenMOSS-Team/MOSS-SoundEffect-v2.0. Evidencia y rutas en investigacion-v2.md.
- El replay 25fe89ae confirma el tower rush de 83,9 segundos: jugador Codex, 7 órdenes de torreta. La atribución tentativa a Astra quedó corregida.
- Precisar las configuraciones comparadas. El dictado mezcla modelos, proveedores y harnesses. Las observaciones son resultados de estas partidas, no un ranking general.
- La frase «5,5 effort máximo contra low» quizás se refiere a una versión concreta de modelo. No fijar el número sin confirmación.
- «full decision como Jev» quedó como «modelo de decisiones como Jev», según la [descripción oficial de TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev). No afirmar difusión. El fragmento «RL de Transmi» queda en general como agentes de reinforcement learning.
- La autonomía, la duración de la implementación y el número de versiones son recuerdos del autor. Contrastarlos con sesiones o código antes de presentarlos como métricas exactas.
