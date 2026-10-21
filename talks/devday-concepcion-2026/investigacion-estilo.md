# Voz y presentaciones de Emerson: evidencia para la charla AoA

La investigación de voz sigue vigente. Las propuestas visuales iniciales ceden ante una instrucción posterior de Emerson: introducción blanca con BipBop, CChC y Revi, y luego el diseño real del juego, que implementó Claude Opus. Ver [estructura.md](estructura.md).

Investigación local, 15 octubre 2026, con originales intactos. El corpus social salió de Pacifico (`search_sessions` → `read_session` acotado) y luego del archivo que esa sesión señala.

## 1. Voz a usar

Fuente principal: `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-linkedin/memory/linkedin-posts-corpus.md`. Es una captura local del feed de LinkedIn del 27 julio 2026, no una verificación nueva de publicaciones activas.

La sesión `8de53cd5-5f73-42c4-ac33-0556358661b1` (mensajes 0–7) confirma que el usuario pidió recopilar sus posts. Luego comentó que buena parte de la etapa antigua le daba cringe. Los reposts ajenos y los drafts de startups no prueban su voz personal.

- **Curiosidad que termina en algo construido.** Post #3: “Quería saber cómo pivotean las startups en Chile. Terminé armando un sitio…” (líneas 13–16). Favorece primera persona y decisiones reales. No le asignes a AoA una motivación específica sin evidencia del proyecto.
- **Proyectos concretos primero.** #37 Kapin: “problema que encontré” → “mi solución” → repo → “dejé unos aprendizajes en el README :)” (182–188). Explica qué hace el sistema, con detalles, sin exagerar.
- **Diversión explícita y natural.** #38 CONDOR: “CONDOR es el jueguito que hice para el Arcade Challenge de la Platanus Hack 25”; “me divertí harto haciendolo y pensando como hacer que sea divertido jugarlo” (190–198). Es el antecedente más cercano a AoA.
- **Humor seco y autocrítica pequeña.** #32 abre una lista de mejoras con “nos hackearon” (138–147). CONDOR incluye “un beat jungle (intento)” y remata “obvio con Claude Code” (196–197). La broma de Claude tachado calza ahí. Basta una broma clara; nada de memes por todos lados.
- **Chileno sin caricatura.** Usa “harto”, “bacán”, “jueguito”, “pizzitas”, “conce”, “sequisimos”. No agregues “po”, garabatos ni modismos sin evidencia.
- **Lenguaje horizontal.** #36: “gente tan bacán / que después de trabajar toda la semana, vienen y el fin de semana no lo duermen construyendo por gusto” (177–180). #26 describe “charlas bien horizontales y luego pizzitas”. Habla como builder entre builders, no como keynote corporativa.
- **Lo actual: minúsculas frecuentes, frases cortas, inglés técnico cotidiano.** “update”, “sideproject”, “repo”, “feedback”, “handmade”. Ante devs no traduzcas cada término. No copies errores ortográficos. El título pedido puede llevar mayúsculas.
- **Cierra con un objeto tangible o una invitación concreta:** juego, repo, sitio, pregunta útil. Evita “revolucionar”, “el futuro ya está aquí”, “transformación”, lecciones inventadas y tríos motivacionales.

El corpus separa la etapa reciente de la etapa 2024, con muchos hashtags y emojis. Prioriza la voz reciente. MEMORY.md 3115–3116 registra que el usuario rechaza sobreeditar su lenguaje. Un borrador asistido no prueba una publicación.

## 2. Presentaciones inspeccionadas

### ML-PresentaciónProyecto (2023), individual, 12 slides

Archivos:
- `/Users/emersoftware/Library/Mobile Documents/com~apple~Keynote/Documents/ML-PresentaciónProyecto.key`
- `/Users/emersoftware/Library/Mobile Documents/com~apple~Keynote/Documents/ML-PresentaciónProyecto.pptx`

Leí los 12 XML del PPTX y vi el preview original del Keynote. Portada: título enorme blanco a la izquierda, fondo casi negro con ondas azules, subtítulo de curso y nombre abajo a la izquierda. Domina Helvetica Neue, según los estilos del archivo. No es una plantilla de tarjetas UI.

Secuencia real:
1. Ajuste fino con QLoRA de LLaMA 2 con Corpus de La Ley Chilena.
2. Problema: alucinaciones.
3. Captura “Alucinaciones en Bard”.
4. Misma situación: mostrar dónde está el error y el texto correcto.
5. Captura “Alucinaciones en ChatGPT”.
6. Explicación del error.
7. Propuesta para solucionar el problema.
8. LLaMA 2 (visual).
9. QLoRA (visual).
10. Biblioteca del Congreso Nacional (visual).
11. Validación con preguntas y comparación contra modelo sin ajustar.
12. Gracias.

Patrón útil: **problema → ejemplo real → examinar qué falló → propuesta → explicar piezas → validar**. Lleva a la audiencia de un caso visible a la técnica. Para AoA: partida o bug antes del diagrama o la arquitectura. Revisé los interiores por XML y conteo de imágenes, sin renderizarlos completos.

### ESalazar-MRoman (Arduino, 2023), coautoría, 8 slides

Misma carpeta Keynote, `.key` y `.pptx`. Portada vista: fondo claro, título negro grande en Futura Bold, planta con placa Arduino al centro y nombres en las esquinas inferiores. Cuerpo en Arial, títulos en Futura Bold (39–80 pt en XML), texto de ~20–21 pt.

Secuencia: portada → introducción → problema/objetivo → objetivos específicos → materiales en 2 slides → otros servicios/entorno → metodología de 6 pasos. Es académico y más denso que lo apropiado aquí.

Toma la jerarquía tipográfica y la imagen protagonista. No copies introducciones largas, objetivos de tesis ni densidad.

### PT-Defensa (marzo 2024), individual, solo portada verificada

`/Users/emersoftware/Library/Mobile Documents/com~apple~CloudDocs/PT-Defensa.key`

Preview original: fondo blanco, título serif negro centrado, logo de la facultad arriba, y nombre, guía, fecha y gran captura del producto Chat Legal Chile con fondo rojo suave. Título: “Agente de Preguntas Sobre La Ley Chilena Basado en Generación Aumentada Por Recuperación”.

Sigue el código formal de una defensa universitaria y no representa su estilo de meetup. Sí confirma su hábito de darle protagonismo al producto real.

### AnteproyectoProblema (agosto 2023), solo portada verificada

`/Users/emersoftware/Library/Mobile Documents/com~apple~Keynote/Documents/AnteproyectoProblema.key`

Preview original: fondo blanco, título sans grande con degradado naranja/rosa/magenta, “Solución de Mezcla de Colores”, subtítulo negro, nombre y mucho espacio libre. Es otra variante académica, no una identidad visual fija.

También aparecieron presentaciones grupales de pudú/realidad virtual, seguridad y logística, y material de docentes. Descarté el material docente para no atribuírselo a Emerson.

## 3. Aplicación propuesta

- Composición: usa ML como referencia principal: título enorme, pocas palabras, imágenes y capturas grandes, y explicar lo visible.
- Habla: usa los posts recientes: “hice”, “probé”, “quería ver”, “pasó esto”, siempre con hechos comprobados.
- Azul muy oscuro, blanco y el rojo/oro del estandarte funcionan con ML y con el universo medieval pedido. Esa paleta medieval es una decisión nueva, no un rasgo de los decks antiguos.
- Portada: título a la izquierda, estandarte a la derecha. Claude con un único espadazo, como chiste rápido. No lo repitas en toda la charla.
- Orden narrativo útil: enseñar el juego → por qué me metí → qué juego construí y qué hace el agente → cómo llegué ahí → problema concreto y arreglo → aprendizajes honestos → juego/repo.
- Separa frases confirmadas del usuario del copy nuevo en su voz. No pongas invenciones entre comillas.

## 4. Archivos de referencia extraídos

Copié los previews originales a `/tmp/aoa-talk-references/`:
- `ML-PresentaciónProyecto-preview.jpg`
- `ESalazar-MRoman-preview.jpg`
- `PT-Defensa-preview.jpg`
- `AnteproyectoProblema-preview.jpg`

Intenté exportar ML con Keynote. La app abrió su onboarding, cuyo botón Continue acepta una licencia. No la acepté ni exporté. Previews y XML bastan para esta primera versión. No presentes esto como una inspección visual de cada slide de cada Keynote.

## Citas de memoria usadas

`MEMORY.md:3083-3091` ayudó a ubicar la búsqueda de posts e historial. `MEMORY.md:3115-3122` orientó cómo preservar la voz y acotar la recuperación con Pacifico. Rollout: `01a0a04e-6952-7e01-bca1-44f74737f057`. Verifiqué que el corpus de LinkedIn existe como archivo y contrasté su origen con Pacifico en esta investigación.
