# Arquero: idle en ocho direcciones

Abre `index.html` para ver las 8 direcciones en color o como sprites en gris.
Estas animaciones aún no están conectadas al renderer del juego.

Prompt corto:

> Seamless idle loop, gentle breathing and subtle cloak sway. Feet planted, bow steady. Fixed isometric camera. Preserve character, facing and magenta background.

Las 5 referencias vienen de `assets/raw/ranger_sheet.png`. Cada vista usa la misma
imagen de pie como cuadro inicial y final. El script genera S, SE, E, NE y N. NW, W y
SW son espejos de NE, E y SE, según `SHEET_VIEW` y `MIRRORED` de
`packages/web/src/render/sprites.ts`.

Parámetros: MiniMax H3 Turbo LoRA, 544 × 544, duración pedida de 2 s, 4 pasos, seed 42,
LoRA larry, upsample apagado. Cada dirección guarda prompt, referencia, video original y
reporte.

## Archivos exportados

- `export/idle-{s,se,e,ne,n,nw,w,sw}.gif`: ocho vistas transparentes en color.
- `export/ranger-idle.png`: atlas en gris con cinco filas.
- `export/idle-{s,se,e,ne,n}.png`: una fila del atlas por vista base.
- `export/manifest.json`: cuadros, fps, anclaje y correspondencia de direcciones.

El formato es compatible con la entrega de caminar: 28 cuadros a 12 fps, celdas de
112 × 112, atlas de 3136 × 560, anclaje `(0.5, 0.90625)`, escala almacenada 3.
El script quita el fondo magenta y aplica una traslación fija por clip para alinear
capucha y suelo, sin estabilizar ni cancelar la respiración cuadro a cuadro.

## Reproducir

```sh
uv run --with gradio_client python assets/animations/ranger/idle-directions/generate.py
node assets/animations/ranger/idle-directions/package.mjs
```

La generación usa tu sesión local de `hf auth login` y no guarda credenciales.
Para una sola dirección, agrega `s`, `se`, `e`, `ne` o `n` al comando.
Al reanudar, salta los videos existentes.
