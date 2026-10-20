# Investigación para charla AoA — 15 octubre 2026

Documento de investigación inicial. Las fuentes y criterios siguen siendo útiles; el arco provisional de abajo fue reemplazado por el dictado de Emerson y su instrucción de abrir con Revi sobre fondo blanco. La estructura vigente es [estructura.md](estructura.md), con 22 escenas y 23 minutos más 2 de margen.

## Evento verificado

El martes es **20 de octubre de 2026**, 18:00–21:00, Universidad del Desarrollo, Concepción. Verificado en JSON-LD público de [Luma](https://luma.com/vum72ikz), `startDate=2026-10-20T18:00:00.000-03:00`, `endDate=2026-10-20T21:00:00.000-03:00`. El calendario público de [Codex Community Events](https://luma.com/codex-community) también lo sitúa ese martes a las 18:00 GMT-3.

Es un encuentro comunitario organizado por Alonso Astroza, embajador de Codex, junto a Ingeniería UDD. Audiencia declarada: desarrolladores, estudiantes, founders y builders locales. Tres charlas publicadas: ciencia con agentes (Mabel Vidal), juego por y para agentes (Emerson), novedades DevDay (Alonso). El título público de Emerson ya es **«Por y para agentes: construyendo un juego de estrategia con Codex y Claude»**. El título pedido para portada funciona como variación escénica/humorística. La página no publica slot individual ni preguntas; los 25 min provienen del usuario. No se debe presentar como charla oficial corporativa de OpenAI ni atribuir aprobación editorial.

## Qué tomar de las guías y cómo aplicarlo

- **Una sola idea que merezca contarse.** TED pide estructura, brevedad y que cada punto pruebe la idea central. Aquí propongo provisionalmente: «Hacer un juego para agentes me obligó a aprender qué necesitan los agentes para construir y para jugar». Es propuesta editorial, no conclusión histórica aún: contrastar con las sesiones/código. Permite responder por qué, cómo, para qué y qué aprendí sin cinco charlas distintas. [TED, Prepare speakers and program](https://www.ted.com/tedx/organizer-guide/prepare-speakers-and-program).
- **Mostrar la tensión en escenas.** Duarte propone una idea principal, un público con un papel en la historia y movimiento entre situación actual y posibilidad. Aquí: una intención personal → primer resultado visible → problema concreto → decisión de diseño → resultado → algo reutilizable por quienes construyen con agentes. Elegir dos o tres giros reales del proyecto, no cronología de commits ni enumeración del stack. [Duarte, Business Storytelling](https://www.duarte.com/resources/communication-skills/business-storytelling/).
- **La demo muestra una decisión y su consecuencia.** Berkun recomienda problema claro, pocos pasos, payoff rápido y contingencia local. Aquí bastan 60–90 s de una partida/replay legible: qué sabe un agente, qué ordena, qué cambia en el mapa. Un segundo ejemplo puede enseñar una mala decisión real, si existe evidencia. Tener video local, entrada preabierta y corte rápido; no instalar herramientas ni esperar una respuesta de modelo en escena. [Berkun, How to give a perfect demo](https://scottberkun.com/2011/how-to-give-a-perfect-demo/).
- **La audiencia necesita llevarse respuestas.** Berkun pide decidir qué preguntas necesita contestar la charla y ensayar con personas que den feedback. Aquí: «¿Qué parte hizo el agente?», «¿Dónde tuve que intervenir yo?» y «¿Qué puedo copiar mañana?». Cada insight final debe apuntar a una escena ya vista. [Berkun, How To Be a Better Speaker](https://scottberkun.com/2016/how-to-be-a-better-speaker/).

TED sirve como disciplina narrativa y de ensayo. No adoptar su límite ni su retórica: este meetup admite detalles técnicos, humor sobre herramientas y una demo. El tono final debe venir de los posts/presentaciones del usuario, no de estas guías.

## Arco recomendado y reparto de tiempo (provisional hasta evidencia local)

| Minutos | Escena | Función y evidencia visual |
|---|---|---|
| 0:00–1:00 | Portada con espadazo; vistazo al juego | Chiste breve, luego enseguida qué es un RTS y quién juega. Bandera como acento; juego real antes de biografía. |
| 1:00–3:00 | Por qué me metí en esto | Motivación personal real, una foto/post/cita propia que la sostenga. No inventar nostalgia gamer ni «siempre quise». |
| 3:00–5:00 | Por y para agentes | Distinguir agentes que desarrollan de agentes que juegan, visualmente en dos momentos. Para qué sirve el experimento, sin prometer benchmark universal. |
| 5:00–8:00 | Una partida, una decisión | 60–90 s de demo/replay + explicación. Situación → información disponible → orden → efecto; identificar explícitamente replay o vivo. |
| 8:00–12:00 | Cómo funciona | Diagrama mínimo que crece en tres pasos: mundo/reglas, observación/herramientas, acción/resultado. Mostrar un ejemplo real, no un JSON ilegible. |
| 12:00–17:00 | Cómo lo construí | Dos o tres episodios respaldados: pedido inicial, iteración visual, problema que no se arregló con otro prompt. Codex/Claude dentro de un flujo concreto; capturas recortadas y fechas si ayudan. |
| 17:00–20:00 | Lo difícil / lo que me sorprendió | Un fallo real y su cambio de diseño. Separar evidencia de hipótesis. Reservar la sorpresa más potente para aquí. |
| 20:00–23:00 | Tres cosas que me llevo | Cada una conecta escena → principio → acción pequeña del público. Cierre vuelve al juego/bandera y deja repo/URL real. |
| 23:00–25:00 | Margen o preguntas | Hasta confirmar con organizador si los 25 min incluyen Q&A. Si no, usar ese margen para respirar y cerrar a tiempo. |

No fijar un número dogmático de slides: aproximadamente 15–18 escenas principales más 2–3 apéndices técnicos. Es una recomendación para esta charla, no una regla respaldada por las fuentes. En el deck, las slides llevan titulares e imágenes; guion y notas guardan detalle y enlaces. Para ensayo, preparar versión de 22–23 min con puntos de corte, no hablar más rápido.

## Ideas concretas de puesta en escena

1. Portada: «Haciendo un RTS con Codex y Claude», con Claude legible pero cruzado por un solo espadazo. Pausa corta para que la sala lea el chiste; no sostener la competencia de marcas durante la charla.
2. Una apertura posible, pendiente de tono y evidencia: «Esto es un juego de estrategia. Pero yo no estoy jugando». Mostrar mapa antes de explicar la arquitectura. Solo usar esa frase si el ejemplo realmente es autónomo.
3. En el bloque técnico, seguir una unidad del mapa y una orden durante las tres slides. Evita que el público de estudiantes tenga que aprender el juego y la arquitectura simultáneamente.
4. En «cómo lo hice», un antes/después real vale más que logos de todas las herramientas. Para cada episodio: qué pedí, qué salió, qué tuve que decidir.
5. Cierre con invitación concreta: probar una partida o construir un experimento chico y observable, según el estado real del repo. No prometer instalación fácil o acceso público si no están verificados.

## Demo y proyección: decisiones propuestas

- Mostrar partida grabada/replay como primera opción si la arquitectura depende de llamadas de modelos. La interacción puede ser mover cámara, pausar o alternar perspectiva, sin hacer depender la historia de que el modelo responda en ese momento.
- Mantener un MP4 local del mismo caso y un fotograma con el desenlace. La demo debe funcionar sin Wi-Fi. Si usamos el motor dentro del HTML, el build debe contener assets locales y comprobarse con red apagada.
- Marcar claramente «replay» o «en vivo». Si el motor HTML es una recreación ilustrativa, rotularlo como tal; no presentarlo como partida real.
- Para este slot, mi propuesta es fallback a los 10 s de atasco, más corta que el máximo de 45 s sugerido por Berkun. El valor es explicar el caso, no depurar en escenario.
- Verificar 16:9, proyector, fullscreen, clicker, audio si existiera y notas privadas. Son tareas de preparación; no bloquean construir el primer borrador.

## Pendientes que no bloquean el borrador

- Confirmar si 25 min incluyen preguntas y cuál es la hora de la charla.
- Elegir junto a evidencia local el motivo personal, una partida concreta y un fracaso/insight real.
- Determinar cuánto detalle técnico ha mostrado en sus decks previos; usar eso para calibrar densidad.
- No atribuir cifras de horas, costo, líneas, porcentaje «hecho por IA», tasas de victoria ni capacidades del modelo sin fuente local comprobable.
