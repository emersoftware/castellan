# Caminata con prompt corto

Esta prueba da una caminata continua que no vuelve a la postura de reposo. Es
un candidato para revisión visual y todavía no está integrado al juego.

Prompt exacto:

> Seamless walk cycle in place, constant pace from first to last frame, no pauses or easing. Fixed isometric camera. Preserve character, bow and magenta background.

Usamos la misma imagen al principio y al final: el cuadro 12 de la segunda
prueba, con el arquero a mitad de paso. Así evitamos la pose estática de pie de
las pruebas anteriores. Mantuvimos 544 × 544, seed 42, 4 pasos, LoRA larry,
duración solicitada 2 s y upsample desactivado.

El resultado tiene 56 cuadros a 24 fps (2,333 s).

- `index.html`: comparación con la segunda prueba.
- `walk.gif`: GIF con fondo transparente, 12 fps.
- `preview.gif`: GIF completo con el fondo magenta original.
- `generated.mp4`: video original del modelo.
- `reference.png`: cuadro a mitad de paso usado en ambos extremos.
- `request.json`: prompt y parámetros exactos.
- `generate.py`: ejecución por CLI con la sesión local de Hugging Face.
