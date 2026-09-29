# Arquero: caminata en ocho direcciones

Abrir `index.html` para ver las ocho direcciones en color o como sprites en gris.

Se conserva la caminata al este aprobada de `../walk-east-continuous/generated.mp4`.
Sur, sureste, noreste y norte se generaron con las vistas respectivas de
`assets/raw/ranger_sheet.png`. Cada vista se generó primero desde la pose de pie;
después se tomó su cuadro 12, a mitad de paso, como imagen inicial y final de la
generación continua. Los originales y los parámetros se conservan por dirección
en `bootstrap/` y `continuous/`.

Prompt corto para las cuatro vistas nuevas:

> Seamless walk cycle in place, constant pace from first to last frame, no pauses or easing. Fixed isometric camera. Preserve character, facing, bow and magenta background.

MiniMax H3 Turbo LoRA, 544 × 544, 4 pasos, seed 42, LoRA larry, upsample apagado.
Cada resultado original tiene 56 cuadros a 24 fps (2,333 s). Las exportaciones
muestrean 28 cuadros a 12 fps. Se elimina el fondo magenta y se aplica una
traslación fija por clip para alinear la capucha y la línea de suelo, conservando
el movimiento dentro del clip.

## Entrega

- `export/walk-{s,se,e,ne,n,nw,w,sw}.gif`: ocho vistas transparentes en color.
- `export/ranger-walk.png`: atlas en gris con cinco filas, 28 cuadros por fila.
- `export/walk-{s,se,e,ne,n}.png`: cada fila del atlas por separado.
- `export/manifest.json`: dirección, fila, espejo, anclaje, tamaño y fps.
- `export/overview.png`: vista estática de las ocho orientaciones.

Cada celda del atlas mide 112 × 112 px. El tamaño completo es 3136 × 560 px.
El anclaje es `(0.5, 0.90625)`; `storedScale: 3` indica la escala de almacenamiento
que usa actualmente el juego. El renderer ya reproduce este atlas.

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
`packages/web/src/render/sprites.ts`. Como en los sprites estáticos, el espejo
también invierte el lado aparente del arco.

## Reproducir

```sh
uv run --with gradio_client python assets/animations/ranger/walk-directions/generate.py bootstrap
uv run --with gradio_client python assets/animations/ranger/walk-directions/generate.py continuous
node assets/animations/ranger/walk-directions/package.mjs
```

La generación requiere la sesión de `hf auth login`; no guarda credenciales.
Se puede agregar `s`, `se`, `ne` o `n` al comando para limitar la generación a una
vista. Los videos ya generados se omiten al reanudar.

Verificación realizada: revisión de las secuencias de las cuatro vistas nuevas,
28 cuadros y transparencia en los ocho GIFs, dimensiones y canal alfa del atlas,
y correspondencia del mapa de direcciones con el renderer actual.

## Continuidad en el juego

El arquero mantiene un tramo de movimiento durante toda la duración de un paso
(`stats.moveMs`, con fallback a las reglas y redondeo al tick del motor). Los
paquetes intermedios con la misma casilla no interrumpen la caminata ni reinician
la interpolación. Al detenerse o bloquearse, vuelve a idle al terminar el paso.
El reloj de simulación conserva la fase al pausar, cambiar velocidad o buscar
otro momento del replay.

Un disparo corta la caminata inmediatamente: el arquero completa el tramo
pendiente en un tick y la flecha nace en su posición visible, incorporándose a
la trayectoria simulada durante ese mismo tick. El motor conserva el instante
de lanzamiento, las colisiones y el daño.
