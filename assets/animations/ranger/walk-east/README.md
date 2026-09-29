# Arquero: primera prueba de caminata hacia la derecha

Generado el 2026-09-28 con la API pública de
[MiniMax-H3-Turbo-Lora](https://huggingface.co/spaces/MiniMaxAI/MiniMax-H3-Turbo-Lora).
La conexión funcionó sin token. El Space informa `mcp_server: false`; se usó
`gradio_client` desde CLI.

- `reference.png`: recorte del arquero de perfil de `assets/raw/ranger_sheet.png`.
- `generated.mp4`: resultado original, 544 × 544, 56 fotogramas a 24 fps.
- `preview.gif`: video completo, incluido el arranque y la detención.
- `walk.gif`: candidato de ciclo continuo, en color y con transparencia.
- `walk-sprite.gif`: candidato en gris, ampliado para revisar.
- `spritesheet.png` y `spritesheet.json`: 14 fotogramas de 112 × 112, a 12 fps.
- `frames/`: fotogramas extraídos y versiones procesadas.
- `request.json`, `result.json`, `generate.py`: parámetros, reporte y ejecución.

Se eligieron los fotogramas 8 a 34 inclusive, cada dos fotogramas, para quitar
las pausas. Se eliminó el fondo magenta y se estabilizó el personaje usando el
centro horizontal de la capucha y la altura inferior de los pies. La versión
del spritesheet está en escala de grises. Este ciclo es una primera prueba
visual: el cierre puede requerir ajuste, y todavía no se ha integrado al juego.
Solo cubre la dirección este.

Para volver a generar (usa cuota de Hugging Face):

```sh
uv run --with gradio_client python assets/animations/ranger/walk-east/generate.py
```

Puede recibir `HF_TOKEN` desde el entorno. No guarda credenciales.
