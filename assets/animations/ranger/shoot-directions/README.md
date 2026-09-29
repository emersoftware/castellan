# Arquero: disparo en ocho direcciones

Abrir `index.html` para revisar las ocho orientaciones en color o gris.

Se probaron prompts cortos y se seleccionó la toma con la acción más legible
para cada vista. El prompt exacto de cada toma seleccionada está en su
`request.json`. Ejemplo frontal:

> Bow shot toward bottom edge of frame: draw string to cheek, release, return to idle. Fixed isometric camera, feet planted, unchanged character and magenta background.

Se usan las cinco vistas de `assets/raw/ranger_sheet.png`: S, SE, E, NE y N.
Cada vista usa la misma pose de reposo como imagen inicial y final. NW, W y SW
son espejos, siguiendo la correspondencia actual del renderer.

La referencia se desplaza 40 px hacia abajo dentro del lienzo de 544 × 544 para
dar espacio al arco levantado. Las pruebas alternativas se conservan en `attempt-*/`. Se eligió la cuarta toma
frontal, la tercera sureste, la segunda este y la primera para NE y N.
Los archivos en la raíz de cada dirección contienen la selección exportada.

Parámetros comunes: MiniMax H3 Turbo LoRA, LoRA larry, upsample apagado,
duración solicitada 2 s. Cada generación conserva referencia, prompt, video,
reporte y secuencia de revisión en su carpeta de dirección.

## Entrega

- `export/shoot-{s,se,e,ne,n,nw,w,sw}.gif`: ocho vistas transparentes en color.
- `export/ranger-shoot.png`: atlas en gris de cinco filas.
- `export/shoot-{s,se,e,ne,n}.png`: una fila por vista base.
- `export/manifest.json`: tamaño, cuadros, fps, anclaje y direcciones.

28 cuadros a 12 fps; celdas de 112 × 112; atlas de 3136 × 560.
El anclaje es `(0.5, 0.90625)`, con escala almacenada 3, como las entregas de
idle y caminar. Se alinea todo el clip según la primera pose; no se estabiliza
el brazo ni el arco durante el movimiento.

El manifiesto indica `loop: false`: representa un único disparo. Los GIFs y la
vista HTML se repiten únicamente para facilitar su revisión. La integración al
renderer y la sincronización con el proyectil del motor quedan pendientes.

## Reproducir

```sh
uv run --with gradio_client python assets/animations/ranger/shoot-directions/generate.py
node assets/animations/ranger/shoot-directions/package.mjs
```

Puede agregarse una dirección al comando de generación. Usa la sesión de
`hf auth login`, omite videos existentes y no guarda credenciales en el proyecto.

## Tomas seleccionadas y revisión

| Vista | Pasos | Seed |
| --- | --- | --- |
| S | 6 | 17 |
| SE | 6 | 42 |
| E | 4 | 42 |
| NE | 4 | 42 |
| N | 4 | 42 |

Se revisaron las secuencias exportadas de las cinco vistas. Se verificaron
56 cuadros a 24 fps en los videos y 28 cuadros con transparencia en cada GIF.
La exportación retiene el componente del personaje y el equipo que sostiene,
con un margen de dos píxeles para uniones finas, y elimina componentes separados
como la flecha en vuelo. Los videos originales conservan toda la generación.

`export/timeline.png` muestra las cinco acciones ya recortadas;
`export/overview.png` muestra las ocho orientaciones. Es una primera versión
visual: el arco presenta pequeñas variaciones de forma durante el tensado.

## Game integration

`node packages/web/scripts/ranger-animations.mjs` copies the reviewed idle,
walk and shoot atlases into `packages/web/public/sprites/ranger`.
The runtime manifest records zero-based release markers for S/SE/E/NE/N:
14, 18, 19, 18, 16. Mirrored directions share their source marker.

The engine keeps its immediate launch. The renderer starts at the release
marker on the authoritative `attack` event and plays 300 ms of recovery in
simulation time. Shooting facing comes from the projectile launch vector
(or the target for legacy replays), locked independently of movement.
No windup, extra projectile or damage delay is added. Pausing freezes the
animation clock; seeking clears transient shot poses. Idle and walk loop
at their exported 12 fps. Atlas texture sources are shared across renderers.
