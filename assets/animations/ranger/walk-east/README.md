# Arquero: primera prueba de caminata hacia la derecha

Este ciclo es una primera prueba visual. Aún no está en el juego y
el cierre puede requerir ajuste. Solo cubre la dirección este.

Lo generamos el 2026-09-28 con la API pública de
[MiniMax-H3-Turbo-Lora](https://huggingface.co/spaces/MiniMaxAI/MiniMax-H3-Turbo-Lora).
Funcionó sin token. El Space informa `mcp_server: false`, así que
usamos `gradio_client` desde CLI.

- `reference.png`: recorte del arquero de perfil de `assets/raw/ranger_sheet.png`.
- `generated.mp4`: resultado original, 544 × 544, 56 fotogramas a 24 fps.
- `preview.gif`: video completo, incluido el arranque y la detención.
- `walk.gif`: candidato de ciclo continuo, en color y con transparencia.
- `walk-sprite.gif`: candidato en gris, ampliado para revisar.
- `spritesheet.png` y `spritesheet.json`: 14 fotogramas de 112 × 112, a 12 fps.
- `frames/`: fotogramas extraídos y versiones procesadas.
- `request.json`, `result.json`, `generate.py`: parámetros, reporte y ejecución.

Proceso:

1. Elegimos los fotogramas 8 a 34 inclusive, 1 de cada 2, para quitar las pausas.
2. Quitamos el fondo magenta.
3. Estabilizamos al personaje con el centro horizontal de la capucha y la altura inferior de los pies.
4. Dejamos el spritesheet en grises.

Para volver a generar (usa cuota de Hugging Face):

```sh
uv run --with gradio_client python assets/animations/ranger/walk-east/generate.py
```

El script puede leer `HF_TOKEN` del entorno. No guarda credenciales.
