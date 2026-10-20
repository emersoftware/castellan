# Voz y presentaciones de Emerson: evidencia para la charla AoA

La investigación de voz se conserva. Las propuestas visuales iniciales de este documento quedaron subordinadas a la instrucción posterior de Emerson: introducción blanca con BipBop, CChC y Revi; luego el diseño real del juego, implementado por Claude Opus. Ver [estructura.md](estructura.md).

Investigación local, 15 octubre 2026. Originales intactos. Corpus social recuperado con Pacifico primero (`search_sessions` → `read_session` acotado), luego lectura del archivo que esa sesión identifica.

## 1. Voz a usar

Fuente principal: `/Users/emersoftware/.claude/projects/-Users-emersoftware-Documents-projects-linkedin/memory/linkedin-posts-corpus.md`. Es una captura local del feed de LinkedIn realizada el 27 julio 2026, no una verificación nueva de publicaciones activas. La sesión `8de53cd5-5f73-42c4-ac33-0556358661b1` (mensajes 0–7) confirma que el usuario pidió recopilar posts propios y luego comentó que buena parte de la etapa antigua le daba cringe. No usar reposts ajenos ni los drafts de startups como si probaran su voz personal.

- **Curiosidad que termina en algo construido.** Post #3: “Quería saber cómo pivotean las startups en Chile. Terminé armando un sitio…” (líneas 13–16). Para esta charla, favorecer relato primera persona y decisiones reales. No asignar una motivación específica a AoA sin evidencia del proyecto.
- **Proyectos concretos primero.** #37 Kapin: “problema que encontré” → “mi solución” → repo → “dejé unos aprendizajes en el README :)” (182–188). Explica qué hace el sistema, incluyendo detalles, sin exagerar importancia.
- **Diversión explícita y natural.** #38 CONDOR: “CONDOR es el jueguito que hice para el Arcade Challenge de la Platanus Hack 25”; “me divertí harto haciendolo y pensando como hacer que sea divertido jugarlo” (190–198). Es el antecedente más próximo a AoA.
- **Humor seco y autocrítica pequeña.** #32 abre una lista de mejoras con “nos hackearon” (138–147). CONDOR incluye “un beat jungle (intento)” y remata “obvio con Claude Code” (196–197). La broma de Claude tachado funciona en ese registro. Una broma clara basta; no convertir todo en memes.
- **Chileno sin caricatura.** Usa “harto”, “bacán”, “jueguito”, “pizzitas”, “conce”, “sequisimos”. No agregar “po”, garabatos ni modismos que la evidencia no sostiene.
- **Lenguaje horizontal.** #36: “gente tan bacán / que después de trabajar toda la semana, vienen y el fin de semana no lo duermen construyendo por gusto” (177–180). #26 describe “charlas bien horizontales y luego pizzitas”. Hablar como builder entre builders, sin voz de keynote corporativa.
- **Actual: minúsculas frecuentes, frases cortas, inglés técnico cotidiano.** “update”, “sideproject”, “repo”, “feedback”, “handmade”. No necesita traducir cada término ante devs. No copiar errores ortográficos. El título solicitado puede conservar mayúsculas.
- **Cierra con objeto tangible / invitación concreta.** Juego, repo, sitio, pregunta útil. Evitar “revolucionar”, “el futuro ya está aquí”, “transformación”, lecciones inventadas y tricolones motivacionales.

El corpus distingue era reciente de la etapa 2024 con muchos hashtags y emojis. Priorizar la voz reciente. Rechazo del usuario a sobreeditar su lenguaje también registrado en MEMORY.md 3115–3116; no inferir que los borradores asistidos prueban una publicación.

## 2. Presentaciones inspeccionadas

### ML-PresentaciónProyecto (2023), individual, 12 slides

Archivos:
- `/Users/emersoftware/Library/Mobile Documents/com~apple~Keynote/Documents/ML-PresentaciónProyecto.key`
- `/Users/emersoftware/Library/Mobile Documents/com~apple~Keynote/Documents/ML-PresentaciónProyecto.pptx`

Leí los 12 XML del PPTX y vi el preview original del Keynote. Portada: título enorme blanco, alineado izquierda, fondo casi negro con ondas azules, subtítulo de curso y nombre abajo izquierda. Helvetica Neue dominante según estilos del archivo; no es una plantilla de tarjetas UI.

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

Patrón útil: **problema → ejemplo real → examinar qué falló → propuesta → explicar piezas → validar**. Lleva la audiencia desde un caso visible hasta la técnica. Para AoA, mostrar partida o bug antes de diagrama/arquitectura. Los interiores fueron inspeccionados mediante XML y conteo de imágenes, no renderizados completos.

### ESalazar-MRoman (Arduino, 2023), coautoría, 8 slides

Misma carpeta Keynote, `.key` y `.pptx`. Portada vista: fondo claro, título negro Futura Bold grande, planta con placa Arduino como imagen central, nombres en esquinas inferiores. Cuerpo Arial, títulos Futura Bold (39–80 pt en XML), texto ~20–21 pt. Secuencia: portada → introducción → problema/objetivo → objetivos específicos → materiales en dos slides → otros servicios/entorno → metodología de seis pasos. Es académico y más denso que lo apropiado para esta charla.

Tomar de aquí jerarquía tipográfica e imagen protagonista. No copiar largas introducciones, listas de objetivos de tesis ni densidad.

### PT-Defensa (marzo 2024), individual, solo portada verificada

`/Users/emersoftware/Library/Mobile Documents/com~apple~CloudDocs/PT-Defensa.key`

Preview original: blanco, título centrado serif negro, logo facultad arriba, nombre/guía/fecha y gran captura del producto Chat Legal Chile con fondo rojo suave. Título: “Agente de Preguntas Sobre La Ley Chilena Basado en Generación Aumentada Por Recuperación”. Tiene código formal de defensa universitaria. No representa por sí sola su estilo para meetup. Sí confirma hábito de dar protagonismo al producto real.

### AnteproyectoProblema (agosto 2023), solo portada verificada

`/Users/emersoftware/Library/Mobile Documents/com~apple~Keynote/Documents/AnteproyectoProblema.key`

Preview original: blanco, título sans grande con degradado naranja/rosa/magenta “Solución de Mezcla de Colores”, subtítulo negro y nombre abajo. Mucho espacio libre. Es otra variante académica, no una identidad visual fija.

Se localizaron además presentaciones grupales de pudú/realidad virtual, seguridad y logística, y material de docentes. Se descartó el material docente para no atribuirlo a Emerson.

## 3. Aplicación propuesta

- Tomar ML como referencia principal de composición: título enorme, pocas palabras, imágenes/capturas grandes, explicar lo visible.
- Tomar los posts recientes como referencia de habla: “hice”, “probé”, “quería ver”, “pasó esto”, con hechos comprobados.
- Azul muy oscuro, blanco y el rojo/oro de estandarte funcionan con ML y el universo medieval solicitado, pero esa paleta medieval es una decisión nueva para esta charla, no un rasgo descubierto en decks antiguos.
- Portada izquierda título, derecha estandarte. Claude con un único espadazo como chiste rápido. No repetirlo en toda la charla.
- Orden narrativo útil: enseñar juego → por qué me metí → qué juego construí/qué hace el agente → cómo llegué ahí → problema concreto y arreglo → insights honestos → juego/repo.
- Separar frases confirmadas del usuario de copy nuevo escrito en su voz. No poner entre comillas invenciones.

## 4. Archivos de referencia extraídos

Previews originales copiados a `/tmp/aoa-talk-references/`:
- `ML-PresentaciónProyecto-preview.jpg`
- `ESalazar-MRoman-preview.jpg`
- `PT-Defensa-preview.jpg`
- `AnteproyectoProblema-preview.jpg`

Se intentó exportar ML con Keynote. La app abrió su onboarding y el botón Continue acepta una licencia. No se aceptó ni se exportó. Los previews y XML aportan evidencia suficiente para esta primera versión. No presentar esto como una inspección visual de cada slide de cada Keynote.

## Citas de memoria usadas

`MEMORY.md:3083-3091` ayudó a identificar búsqueda de posts/historial; `MEMORY.md:3115-3122` orientó preservación de voz y recuperación acotada Pacifico. Rollout: `01a0a04e-6952-7e01-bca1-44f74737f057`. El corpus de LinkedIn se verificó como archivo existente y su origen se contrastó con Pacifico en esta investigación.
