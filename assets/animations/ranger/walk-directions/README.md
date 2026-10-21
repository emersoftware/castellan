# Arquero: caminata en ocho direcciones

Abre `index.html` para ver las 8 direcciones en color o como sprites en gris. El
renderer ya reproduce este atlas.

La caminata al este aprobada sigue siendo `../walk-east-continuous/generated.mp4`. Sur,
sureste, noreste y norte salen de sus vistas en `assets/raw/ranger_sheet.png`. Cada
vista se generó en 2 pasadas:

1. Desde la pose de pie.
2. Continua, con el cuadro 12 de la anterior (mitad de paso) como imagen inicial y final.

`bootstrap/` y `continuous/` guardan los originales y los parámetros de cada dirección.

Prompt corto para las 4 vistas nuevas:

> Seamless walk cycle in place, constant pace from first to last frame, no pauses or easing. Fixed isometric camera. Preserve character, facing, bow and magenta background.

MiniMax H3 Turbo LoRA, 544 × 544, 4 pasos, seed 42, LoRA larry, upsample apagado. Cada
resultado original tiene 56 cuadros a 24 fps (2,333 s). Las exportaciones toman 28
cuadros a 12 fps. El script quita el fondo magenta y aplica una traslación fija por clip
para alinear capucha y línea de suelo, sin tocar el movimiento dentro del clip.

## Entrega

- `export/walk-{s,se,e,ne,n,nw,w,sw}.gif`: ocho vistas transparentes en color.
- `export/ranger-walk.png`: atlas en gris con cinco filas, 28 cuadros por fila.
- `export/walk-{s,se,e,ne,n}.png`: cada fila del atlas por separado.
- `export/manifest.json`: dirección, fila, espejo, anclaje, tamaño y fps.
- `export/overview.png`: vista estática de las ocho orientaciones.

Cada celda del atlas mide 112 × 112 px. El atlas completo mide 3136 × 560 px. El
anclaje es `(0.5, 0.90625)`. `storedScale: 3` es la escala de almacenamiento que usa
hoy el juego.

| screenDir | Dirección | Fila | Espejo |
| --- | --- | --- | --- |
| 0 | S | 0 | no |
| 1 | SE | 1 | no |
| 2 | E | 2 | no |
| 3 | NE | 3 | no |
| 4 | N | 4 | no |
| 5 | NW | 3 | sí |
| 6 | W | 2 | sí |
| 7 | SW | 1 | sí |

Esta correspondencia sigue `SHEET_VIEW` y `MIRRORED` de
`packages/web/src/render/sprites.ts`. Como en los sprites estáticos, el espejo también
invierte el lado aparente del arco.

## Reproducir

```sh
uv run --with gradio_client python assets/animations/ranger/walk-directions/generate.py bootstrap
uv run --with gradio_client python assets/animations/ranger/walk-directions/generate.py continuous
node assets/animations/ranger/walk-directions/package.mjs
```

La generación necesita la sesión de `hf auth login` y no guarda credenciales. Para
generar solo una vista, agrega `s`, `se`, `ne` o `n` al comando. Al reanudar, el script
salta los videos ya generados.

Verificación hecha: secuencias de las 4 vistas nuevas, 28 cuadros y transparencia en
los 8 GIFs, dimensiones y canal alfa del atlas, y mapa de direcciones frente al renderer
actual.

## Continuidad en el juego

El arquero mantiene un tramo de movimiento durante todo un paso (`stats.moveMs`, con
fallback a las reglas y redondeo al tick del motor). Los paquetes intermedios con la
misma casilla no cortan la caminata ni reinician la interpolación. Si se detiene o lo
bloquean, vuelve a idle al terminar el paso. El reloj de simulación conserva la fase al
pausar, cambiar velocidad o saltar a otro momento del replay.

Un disparo corta la caminata de inmediato. El arquero completa el tramo pendiente en
1 tick. La flecha nace en su posición visible y se une a la trayectoria simulada en ese
mismo tick. El motor conserva el instante de lanzamiento, las colisiones y el daño.
