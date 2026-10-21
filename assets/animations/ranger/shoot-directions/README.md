# Arquero: disparo en ocho direcciones

Abre `index.html` para revisar las 8 orientaciones en color o gris.

Probamos prompts cortos y elegimos la toma con la acción más legible para cada vista.
El `request.json` de cada toma elegida guarda su prompt exacto. Ejemplo frontal:

> Bow shot toward bottom edge of frame: draw string to cheek, release, return to idle. Fixed isometric camera, feet planted, unchanged character and magenta background.

El script usa las 5 vistas de `assets/raw/ranger_sheet.png`: S, SE, E, NE y N. Cada
vista usa la misma pose de reposo como imagen inicial y final. NW, W y SW son espejos,
según la correspondencia actual del renderer.

La referencia baja 40 px dentro del lienzo de 544 × 544 para dejar espacio al arco
levantado. Las pruebas alternativas quedan en `attempt-*/`. Elegimos la 4.ª toma
frontal, la 3.ª sureste, la 2.ª este y la 1.ª para NE y N. Los archivos en la raíz de
cada dirección son la selección exportada.

Parámetros comunes: MiniMax H3 Turbo LoRA, LoRA larry, upsample apagado, duración pedida
2 s. Cada carpeta de dirección guarda referencia, prompt, video, reporte y secuencia de
revisión de cada generación.

## Entrega

- `export/shoot-{s,se,e,ne,n,nw,w,sw}.gif`: ocho vistas transparentes en color.
- `export/ranger-shoot.png`: atlas en gris de cinco filas.
- `export/shoot-{s,se,e,ne,n}.png`: una fila por vista base.
- `export/manifest.json`: tamaño, cuadros, fps, anclaje y direcciones.

28 cuadros a 12 fps; celdas de 112 × 112; atlas de 3136 × 560. El anclaje es
`(0.5, 0.90625)`, con escala almacenada 3, como en idle y caminar. El script alinea
todo el clip según la primera pose. No estabiliza el brazo ni el arco durante el
movimiento.

El manifiesto indica `loop: false`, porque representa un solo disparo. Los GIFs y la
vista HTML se repiten solo para facilitar la revisión. Falta integrarlo al renderer y
sincronizarlo con el proyectil del motor.

## Reproducir

```sh
uv run --with gradio_client python assets/animations/ranger/shoot-directions/generate.py
node assets/animations/ranger/shoot-directions/package.mjs
```

Puedes agregar una dirección al comando de generación. El script usa la sesión de
`hf auth login`, salta los videos existentes y no guarda credenciales en el proyecto.

## Tomas seleccionadas y revisión

| Vista | Pasos | Seed |
| --- | --- | --- |
| S | 6 | 17 |
| SE | 6 | 42 |
| E | 4 | 42 |
| NE | 4 | 42 |
| N | 4 | 42 |

Revisamos las secuencias exportadas de las 5 vistas. Los videos tienen 56 cuadros a
24 fps. Cada GIF tiene 28 cuadros con transparencia. La exportación conserva el
personaje y el equipo que sostiene, con un margen de 2 píxeles para uniones finas.
Quita las piezas separadas, como la flecha en vuelo. Los videos originales conservan
toda la generación.

`export/timeline.png` muestra las 5 acciones ya recortadas. `export/overview.png`
muestra las 8 orientaciones. Es una primera versión visual: el arco cambia un poco de
forma durante el tensado.

## Game integration

`node packages/web/scripts/ranger-animations.mjs` copies the reviewed idle, walk and
shoot atlases into `packages/web/public/sprites/ranger`. The runtime manifest records
zero-based release markers for S/SE/E/NE/N: 14, 18, 19, 18, 16. Mirrored directions
share their source marker.

The engine keeps its immediate launch. On the authoritative `attack` event, the
renderer starts at the release marker. It then plays 300 ms of recovery in simulation
time. The projectile launch vector sets the shooting facing (legacy replays use the
target). This facing is locked independently of movement. Nothing adds a windup, an
extra projectile or a damage delay. Pausing freezes the animation clock. Seeking
clears transient shot poses. Idle and walk loop at their exported 12 fps. Renderers
share the atlas texture sources.
