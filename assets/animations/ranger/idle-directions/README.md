# Arquero: idle en ocho direcciones

Abrir `index.html` para ver las ocho direcciones en color o como sprites en gris.

Prompt corto:

> Seamless idle loop, gentle breathing and subtle cloak sway. Feet planted, bow steady. Fixed isometric camera. Preserve character, facing and magenta background.

Las cinco referencias proceden de `assets/raw/ranger_sheet.png`. Cada vista usa
la misma imagen de pie como cuadro inicial y final. Se generan S, SE, E, NE y N;
NW, W y SW son espejos de NE, E y SE, siguiendo `SHEET_VIEW` y `MIRRORED` de
`packages/web/src/render/sprites.ts`.

Parámetros: MiniMax H3 Turbo LoRA, 544 × 544, duración solicitada de 2 s,
4 pasos, seed 42, LoRA larry, upsample apagado. El prompt, la referencia,
el video original y el reporte se guardan por dirección.

## Archivos exportados

- `export/idle-{s,se,e,ne,n,nw,w,sw}.gif`: ocho vistas transparentes en color.
- `export/ranger-idle.png`: atlas en gris con cinco filas.
- `export/idle-{s,se,e,ne,n}.png`: una fila del atlas por vista base.
- `export/manifest.json`: cuadros, fps, anclaje y correspondencia de direcciones.

Formato compatible con la entrega de caminar: 28 cuadros a 12 fps, celdas de
112 × 112, atlas de 3136 × 560, anclaje `(0.5, 0.90625)`, escala almacenada 3.
Se elimina el fondo magenta y se aplica una traslación fija por clip para alinear
la capucha y el suelo sin estabilizar ni cancelar la respiración cuadro a cuadro.
Falta conectar estas animaciones al renderer del juego.

## Reproducir

```sh
uv run --with gradio_client python assets/animations/ranger/idle-directions/generate.py
node assets/animations/ranger/idle-directions/package.mjs
```

La generación usa la sesión local de `hf auth login` y no guarda credenciales.
Se puede agregar una dirección (`s`, `se`, `e`, `ne`, `n`) al comando para limitar
la generación. Omite los videos existentes al reanudar.
