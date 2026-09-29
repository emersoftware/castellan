# Caminata con prompt corto

Prompt exacto:

> Seamless walk cycle in place, constant pace from first to last frame, no pauses or easing. Fixed isometric camera. Preserve character, bow and magenta background.

La misma imagen se usó al principio y al final: cuadro 12 de la segunda prueba,
con el arquero a mitad de paso. Se evita volver a la pose estática de pie que
aparecía en las pruebas anteriores. Se mantienen 544 × 544, seed 42, 4 pasos,
LoRA larry, duración solicitada 2 s y upsample desactivado.

El resultado tiene 56 cuadros a 24 fps (2,333 s). La revisión de la secuencia
muestra una caminata continua sin volver a la postura de reposo. Es un candidato
para revisión visual, todavía sin integrar al juego.

- `index.html`: comparación con la segunda prueba.
- `walk.gif`: GIF con fondo transparente, 12 fps.
- `preview.gif`: GIF completo con el fondo magenta original.
- `generated.mp4`: video original del modelo.
- `reference.png`: cuadro a mitad de paso utilizado en ambos extremos.
- `request.json`: prompt y parámetros exactos.
- `generate.py`: ejecución por CLI usando la sesión local de Hugging Face.
