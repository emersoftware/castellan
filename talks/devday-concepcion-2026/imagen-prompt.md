# Estandarte de la portada

Generado con la herramienta integrada image_gen; archivo final `assets/estandarte-codex.png`. Referencias: las dos imágenes adjuntas por Emerson (estandarte histórico y vestuario de fantasía). Ilustración original, no fotografía de un objeto real.

```text
Use case: stylized-concept
Asset type: original cover illustration for a developer talk about Castellan, a medieval RTS made with Codex and Claude.
Primary request: a single dramatic medieval war standard carrying the recognizable white six-loop OpenAI/ChatGPT knot emblem, hand-painted fantasy concept art.
Input images: reference 1 gives the historical long forked swallowtail banner shape, embroidery and pole; reference 2 gives the weathered red cloth, dark iron, painterly brushwork and solemn fantasy mood. Create an original object rather than copying either illustration.
Subject: tall dark iron pole with an elegant spear finial, an elaborate weathered deep-crimson and antique-gold banner flowing to the right in two long torn tapering tails; clear large ivory OpenAI/ChatGPT knot emblem embroidered on the main cloth panel. Subtle blue-black lining, realistic fabric folds and worn gold stitching. No human figures.
Composition: whole standard fully visible, portrait aspect ratio, generous space around its silhouette, pole left of the cloth, complete tails inside the frame.
Lighting/mood: warm soft directional light, beautiful painted edges and tactile fabric, historical fantasy game art.
Background: transparent, isolated object.
Text: none, no lettering, no caption or watermark.
Constraints: recognizably a medieval war banner, not a rectangle on a modern flagpole. Elegant and readable at slide scale.
```



# Portada v3: dos reyes en duelo

Generada por Codex (codex-cli 0.163.0, image_gen) el 2026-10-18; archivo `assets/portada-reyes.png` (1672×941). El deck la dibuja con las rampas del juego (`drawPhoto` en scenes.js).

```text
Genera con tu herramienta integrada image_gen la imagen de portada de una charla y guárdala como PNG en assets/portada-reyes.png (dentro de este directorio). Después la vamos a pasar por un dithering de pocos colores, así que prioriza siluetas claras, contraste fuerte y zonas de color planas.

Use case: stylized-concept
Asset type: 16:9 landscape cover illustration (at least 1536×864) for a developer talk «Por y para agentes: construyendo un juego de estrategia con Codex y Claude», about a medieval RTS that AI agents play.
Primary request: two medieval kings fighting each other in a duel, swords clashing at the center, full bodies visible.
Left king: Claude. His shield and tabard carry the Claude logo (Anthropic's warm orange/terracotta starburst). Warm orange palette.
Right king: Codex. His shield and tabard carry the OpenAI/Codex knot logo (white six-loop knot). Cold blue palette.
Composition: kings in the lower two thirds, centered; the top third is calm sky/dark background because a title will be overlaid there. Plain dark background, no busy scenery.
Style: hand-painted fantasy game art, similar to classic Age of Empires II unit art, readable at slide scale.
Text: none, no lettering, no watermark.

Cuando termine, responde solo con la ruta del archivo guardado y su tamaño en píxeles.
```
Usa tu herramienta integrada image_gen para hacer una nueva versión de assets/portada-reyes.png (úsala como referencia de composición, paleta y estilo) y guárdala como PNG en assets/portada-reyes-v2.png.

Único cambio: no se les debe ver la cara a los reyes. Ambos llevan yelmo cerrado de caballero (great helm medieval, cubre toda la cabeza y la cara, solo una ranura para los ojos, sin rasgos visibles), como los caballeros de un RTS clásico tipo Age of Empires II. La corona va encima del yelmo. Sin barba, sin piel visible en la cara.

Mantén todo lo demás: 16:9, dos reyes en duelo con las espadas cruzadas al centro, el de la izquierda (Claude) en naranja/terracota con el logo de Claude (starburst naranja de Anthropic) en escudo y túnica; el de la derecha (Codex) en azul con el nudo de OpenAI/Codex en escudo y túnica; tercio superior libre (fondo oscuro liso) para el título; fondo oscuro sin escenario; sin texto ni marcas de agua. Siluetas claras y contraste fuerte, porque después se pasa por un dithering de pocos colores.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.


# Portada v3: asimétrica, encapuchados, yelmos con forma de logo

```text
Usa tu herramienta integrada image_gen para hacer una nueva portada y guárdala como PNG en assets/portada-reyes-v3.png. Antes mira estas imágenes del proyecto como referencia: assets/portada-reyes-v2.png (la versión anterior: paleta, estilo y que no se ve la cara), assets/art/king-sheet.png y assets/art/knight-sheet.png (los sprites del rey y del caballero del juego: así de encapuchados/cubiertos van).

Cambios respecto a la v2:
1. Composición menos simétrica: nada de espejo. Por ejemplo, Claude atacando en diagonal desde la izquierda, más cerca de la cámara y más grande; Codex más atrás a la derecha, defendiéndose con el escudo en otra pose y altura. Que se sienta un momento de pelea, no dos estatuas.
2. Encapuchados como el rey del juego: sin cara visible, la cabeza y el cuello cubiertos por una capucha o almófar de malla/escamas metálicas que cae sobre los hombros (como un yelmo cónico con una cortina de escamas de acero que tapa toda la cara y el cuello), con la corona encima.
3. Yelmos creativos y distintos entre sí, con la forma de su logo:
   - Claude: su logo es un estallido terracota/naranja (#D97757) de unos 10–12 rayos gruesos, redondeados y de largo irregular, como un asterisco dibujado a mano o un sol, no un escudo con rayos rectos. El yelmo o la corona tienen esa forma de rayos irradiando. El mismo símbolo, bien reconocible, en escudo o túnica.
   - Codex: su logo es el nudo blanco de seis lazos entrelazados de OpenAI. El yelmo lleva ese nudo en relieve en la placa de la cara (como una máscara ornamental de metal con el nudo grabado y barras verticales en la boca), y el nudo también en escudo o túnica.
Mantén: 16:9 (≥1536×864), Claude en naranja/terracota a la izquierda, Codex en azul a la derecha, tercio superior libre con fondo oscuro liso para el título, fondo oscuro sin escenario, estilo pintado de arte de juego tipo Age of Empires II, siluetas claras y contraste fuerte (después se pasa por un dithering de pocos colores), sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v4: misma escala, logo real de Claude (assets/brand/claude-symbol.svg, Wikimedia)

```text
Usa tu herramienta integrada image_gen para hacer una nueva portada y guárdala como PNG en assets/portada-reyes-v4.png. Usa como imágenes de referencia (adjúntalas a image_gen):
- assets/portada-reyes-v3.png: estilo, paleta, capucha de escamas, yelmos con forma de logo. Mantén todo eso.
- assets/brand/claude-symbol.png: el logo REAL de Claude. Cópialo fielmente: un asterisco/chispa terracota (#D97757) de unos 12 rayos rectos y angostos de largo irregular que salen de un centro, con puntas cortadas en ángulo; sin círculo, sin pétalos, sin forma de flor ni de rueda. En la v3 el logo salió como una flor de pétalos redondos: eso está mal.

Cambios respecto a la v3:
1. Composición dinámica pero equilibrada: ninguno queda disminuido. Los dos reyes del mismo tamaño y a la misma distancia de la cámara, con la misma importancia visual, en poses de combate distintas y asimétricas (por ejemplo, Claude lanzando un tajo alto en diagonal y Codex parando con el escudo y contraatacando bajo), espadas o escudo chocando al centro. Ambos de cuerpo entero.
2. Logo de Claude fiel a la referencia, grande y nítido en el escudo, y su corona/yelmo con la forma de esos rayos.
3. Codex igual que en la v3: nudo de OpenAI en relieve en la máscara, en el escudo y en la túnica.
Mantén: 16:9 (≥1536×864), Claude naranja/terracota a la izquierda, Codex azul a la derecha, encapuchados sin cara visible con la corona encima, tercio superior libre con fondo oscuro liso para el título, fondo oscuro sin escenario, estilo pintado de arte de juego tipo Age of Empires II, siluetas claras y contraste fuerte, sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v5: yelmos, escudo sostenido, pasto, ropa entera

```text
Usa tu herramienta integrada image_gen para hacer una nueva portada y guárdala como PNG en assets/portada-reyes-v5.png. Adjunta como referencias: assets/portada-reyes-v4.png (composición y escala que sí funcionan: los dos del mismo tamaño, Claude tajo alto, Codex para con el escudo y contraataca bajo), assets/brand/claude-symbol.png (logo real de Claude, cópialo fiel) y assets/art/king-sheet.png y assets/art/knight-sheet.png (cómo se ven el rey y los caballeros del juego).

Corrige estos problemas de la v4:
1. Los yelmos se ven feos. Hazlos elegantes y bien construidos, cada uno distinto:
   - Claude: yelmo cónico de acero pulido (tipo spangenhelm con remaches) con una cortina de escamas de acero que cae desde el borde y tapa por completo cara y cuello, hasta los hombros. Encima, una corona cuyas puntas son los rayos rectos del logo de Claude.
   - Codex: yelmo ornamental cerrado con placa facial de metal, el nudo de seis lazos de OpenAI en relieve sobre la frente/cara, grabados finos alrededor y barras verticales en la boca; corona clásica encima.
2. El escudo de Claude está flotando: tiene que estar sostenido firmemente por su brazo izquierdo, con la mano en la empuñadura y el escudo pegado al antebrazo, en una posición anatómica creíble.
3. Suelo de pasto como en el juego: pradera verde oscura y corta, con matas y algo de tierra, vista un poco desde arriba, bajo los pies de los dos. Nada de tierra negra ni piso de piedra.
4. Ropas limpias y enteras: túnicas, capas y tabardos sin rasgaduras, sin bordes deshilachados ni jirones. Tela gruesa con pliegues bien definidos.
Mantén: 16:9 (≥1536×864), Claude naranja/terracota a la izquierda con su logo real grande en el escudo y la túnica, Codex azul a la derecha con el nudo en escudo y túnica, sin cara visible, tercio superior libre con cielo/fondo oscuro liso para el título, estilo pintado de arte de juego tipo Age of Empires II, siluetas claras y contraste fuerte, sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v6: sin armiño, un logo por rey, armaduras creativas, sin chispas

```text
Usa tu herramienta integrada image_gen para hacer una nueva portada y guárdala como PNG en assets/portada-reyes-v6.png. Adjunta como referencias: assets/portada-reyes-v5.png (composición, escala, pasto y paleta que sí funcionan), assets/brand/claude-symbol.png (logo real de Claude) y assets/art/king-sheet.png y assets/art/knight-sheet.png (cómo se ven el rey y los caballeros del juego).

Corrige estos problemas de la v5:
1. Nada de piel de armiño: quita todos los forros y bordes blancos con manchas negras de capas y túnicas (parecen pelaje de animal). Usa tela lisa de un solo color, con bordes de oro sencillos. Evita también texturas finas de escamas o cota de malla: armaduras de placas lisas y pulidas.
2. El logo aparece una sola vez por rey, integrado en la armadura (no repetido en túnica, escudo y pecho):
   - Claude: el yelmo ES el logo. Una máscara de acero que cubre toda la cara con la forma del asterisco terracota de Claude (unos 12 rayos rectos y angostos de largo irregular que salen del centro, puntas cortadas en ángulo; sin pétalos ni círculo). Los rayos son placas de metal que irradian desde el centro de la cara. Túnica y escudo de Claude lisos, sin logo.
   - Codex: el escudo ES el logo. Un escudo con la silueta del nudo de seis lazos entrelazados de OpenAI, forjado en acero con el borde azul. Yelmo cerrado elegante, liso, sin logo. Túnica lisa sin logo.
3. Sin chispas, destellos ni brillos en el choque: las espadas y el escudo se tocan de forma realista, sin efectos.
Mantén: 16:9 (≥1536×864), los dos reyes del mismo tamaño en poses dinámicas y asimétricas (Claude tajo alto, Codex para con el escudo y contraataca bajo), Claude naranja/terracota a la izquierda, Codex azul a la derecha, sin cara visible, coronas sobre los yelmos, escudo bien sostenido por el brazo, ropas enteras sin rasgaduras, suelo de pasto verde como en el juego, tercio superior libre con fondo oscuro liso para el título, estilo pintado de arte de juego tipo Age of Empires II, siluetas claras y contraste fuerte, sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v7: desde cero, solo descripción (sin referencias)

```text
Usa tu herramienta integrada image_gen para crear desde cero una ilustración y guárdala como PNG en assets/portada-reyes-v7.png. No uses ninguna imagen de referencia: genera solo a partir de esta descripción.

Escena: dos reyes medievales con armadura completa se enfrentan a espada en una pradera de pasto verde corto, de noche, con fondo azul muy oscuro y liso. Vista lateral, un poco desde arriba, cuerpo entero, los dos del mismo tamaño y a la misma distancia de la cámara. Composición dinámica y asimétrica, pero ninguno queda disminuido: el de la izquierda lanza un tajo alto en diagonal y el de la derecha para con el escudo y contraataca bajo. El tercio superior queda vacío (solo fondo oscuro) para poner un título. Sin chispas, destellos ni efectos en el choque.

Rey de la izquierda (Claude), color terracota/naranja (#D97757):
- Yelmo cerrado de acero liso que tapa toda la cara. En la placa de la cara, en relieve, un asterisco de unos 12 rayos rectos, angostos y de largo irregular que salen del centro, con puntas cortadas en ángulo (sin círculo ni pétalos). Ese asterisco aparece solo ahí, una vez. Corona de oro sencilla encima.
- Escudo de cometa (heater) clásico, bien proporcionado, liso, pintado terracota con un borde de acero limpio y remaches. Lo sujeta firme con el brazo izquierdo, pegado al antebrazo, la mano en la empuñadura. Sin dibujos ni logos.
- Túnica y capa terracota de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Rey de la derecha (Codex), color azul rey:
- Yelmo cerrado de acero liso, elegante, sin dibujos. Corona de oro sencilla encima.
- Escudo con la silueta de un nudo de seis lazos entrelazados (como el logo de OpenAI), forjado en acero con el interior azul. Es el único lugar donde aparece ese símbolo. Lo sostiene firme con el brazo izquierdo.
- Túnica y capa azules de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Armaduras de placas lisas y pulidas; nada de piel de armiño, pelaje, escamas ni cota de malla visible. Estilo: pintura de arte de videojuego de estrategia medieval (tipo Age of Empires II), siluetas claras, contraste fuerte, colores planos y saturados. Formato 16:9, al menos 1536×864. Sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v8: v7 + logo real como referencia

```text
Usa tu herramienta integrada image_gen para crear desde cero una ilustración y guárdala como PNG en assets/portada-reyes-v8.png. Adjunta como única imagen de referencia assets/brand/claude-symbol.png (el logo real de Claude); no uses otras referencias.

Escena: dos reyes medievales con armadura completa se enfrentan a espada en una pradera de pasto verde corto, de noche, con fondo azul muy oscuro y liso. Vista lateral, un poco desde arriba, cuerpo entero, los dos del mismo tamaño y a la misma distancia de la cámara. Composición dinámica y asimétrica, pero ninguno queda disminuido: el de la izquierda lanza un tajo alto en diagonal y el de la derecha para con el escudo y contraataca bajo. El tercio superior queda vacío (solo fondo oscuro) para poner un título. Sin chispas, destellos ni efectos en el choque.

Rey de la izquierda (Claude), color terracota/naranja (#D97757):
- Yelmo cerrado de acero que tapa toda la cara. La placa de la cara ES el logo de Claude: copia exactamente la forma de la imagen de referencia assets/brand/claude-symbol.png (mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas), en terracota sobre el acero, grande, ocupando toda la cara. El logo aparece solo ahí, una vez. Corona de oro sencilla encima.
- Escudo de cometa (heater) clásico, bien proporcionado, liso, pintado terracota con un borde de acero limpio y remaches. Lo sujeta firme con el brazo izquierdo, pegado al antebrazo, la mano en la empuñadura. Sin dibujos ni logos.
- Túnica y capa terracota de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Rey de la derecha (Codex), color azul rey:
- Yelmo cerrado de acero liso, elegante, sin dibujos. Corona de oro sencilla encima.
- Escudo con la silueta de un nudo de seis lazos entrelazados (como el logo de OpenAI), forjado en acero con el interior azul. Es el único lugar donde aparece ese símbolo. Lo sostiene firme con el brazo izquierdo.
- Túnica y capa azules de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Armaduras de placas lisas y pulidas; nada de piel de armiño, pelaje, escamas ni cota de malla visible. Estilo: pintura de arte de videojuego de estrategia medieval (tipo Age of Empires II), siluetas claras, contraste fuerte, colores planos y saturados. Formato 16:9, al menos 1536×864. Sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```

# Portada v8b: edición de v7, solo el yelmo de Claude

```text
Usa tu herramienta integrada image_gen para editar assets/portada-reyes-v7.png y guarda el resultado como PNG en assets/portada-reyes-v8b.png. Adjunta assets/portada-reyes-v7.png y assets/brand/claude-symbol.png (el logo real de Claude).
Cambia solo una cosa: el yelmo del rey de la izquierda (terracota). Su placa de la cara debe SER el logo de Claude, copiado exactamente de assets/brand/claude-symbol.png (mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas), en terracota sobre el acero, grande, ocupando toda la cara. Quita la estrella dorada actual. Todo lo demás queda idéntico: composición, poses, colores, escudos, pasto, fondo, encuadre 16:9, sin texto.
Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v9: edición de v8b, logo claro sobre máscara oscura

```text
Usa tu herramienta integrada image_gen para editar assets/portada-reyes-v8b.png y guarda el resultado como PNG en assets/portada-reyes-v9.png. Adjunta assets/portada-reyes-v8b.png y assets/brand/claude-symbol.png (el logo real de Claude).
Cambia solo el yelmo del rey de la izquierda (terracota). La imagen después se reduce a 3 tonos por color (negro, medio, claro), así que el logo tiene que leerse por contraste de luz, no por color:
- La placa de la cara del yelmo es de acero ennegrecido/pavonado, muy oscura.
- Sobre ella, el logo de Claude en relieve de metal claro y brillante (acero pulido con reflejos), grande, ocupando toda la cara, integrado en el yelmo como parte forjada de la armadura (con volumen, bisel y sombra propia, no pegado encima). Copia exactamente la forma de assets/brand/claude-symbol.png: mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas.
Todo lo demás queda idéntico: composición, poses, colores, escudos, corona, pasto, fondo, encuadre 16:9, sin texto.
Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v10: desde cero, el yelmo de Claude es el logo con rayos que se extienden

```text
Usa tu herramienta integrada image_gen para crear desde cero una ilustración y guárdala como PNG en assets/portada-reyes-v10.png. Adjunta como única imagen de referencia assets/brand/claude-symbol.png (el logo real de Claude); no uses otras referencias.

Escena: dos reyes medievales con armadura completa se enfrentan a espada en una pradera de pasto verde corto, de noche, con fondo azul muy oscuro y liso. Vista lateral, un poco desde arriba, cuerpo entero, los dos del mismo tamaño y a la misma distancia de la cámara. Composición dinámica y asimétrica, pero ninguno queda disminuido: el de la izquierda lanza un tajo alto en diagonal y el de la derecha para con el escudo y contraataca bajo. El tercio superior queda vacío (solo fondo oscuro) para poner un título. Sin chispas, destellos ni efectos en el choque.

Rey de la izquierda (Claude), color terracota/naranja (#D97757):
- El yelmo ES el logo de Claude, en grande y en 3D: la cabeza entera es el asterisco de la imagen de referencia assets/brand/claude-symbol.png, forjado en acero pulido con esmalte terracota. Los rayos salen del centro de la cara y se extienden mucho más allá de la cabeza, como púas largas y afiladas que irradian hacia todos lados (arriba, a los lados, abajo), con la forma exacta de la referencia: mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas en ángulo. No lleva corona aparte: los rayos son su corona. Sin cara visible. Que se lea por contraste de luz (rayos de metal claro y brillante con bordes oscuros), porque la imagen después se reduce a 3 tonos. El logo aparece solo ahí, una vez.
- Escudo de cometa (heater) clásico, bien proporcionado, liso, pintado terracota con un borde de acero limpio y remaches. Lo sujeta firme con el brazo izquierdo, pegado al antebrazo, la mano en la empuñadura. Sin dibujos ni logos.
- Túnica y capa terracota de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Rey de la derecha (Codex), color azul rey:
- Yelmo cerrado de acero liso, elegante, sin dibujos. Corona de oro sencilla encima.
- Escudo con la silueta de un nudo de seis lazos entrelazados (como el logo de OpenAI), forjado en acero con el interior azul. Es el único lugar donde aparece ese símbolo. Lo sostiene firme con el brazo izquierdo.
- Túnica y capa azules de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Armaduras de placas lisas y pulidas; nada de piel de armiño, pelaje, escamas ni cota de malla visible. Estilo: pintura de arte de videojuego de estrategia medieval (tipo Age of Empires II), siluetas claras, contraste fuerte, colores planos y saturados. Formato 16:9, al menos 1536×864. Sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```
```text
Usa tu herramienta integrada image_gen para crear desde cero una ilustración y guárdala como PNG en assets/portada-reyes-v8.png. Adjunta como única imagen de referencia assets/brand/claude-symbol.png (el logo real de Claude); no uses otras referencias.

Escena: dos reyes medievales con armadura completa se enfrentan a espada en una pradera de pasto verde corto, de noche, con fondo azul muy oscuro y liso. Vista lateral, un poco desde arriba, cuerpo entero, los dos del mismo tamaño y a la misma distancia de la cámara. Composición dinámica y asimétrica, pero ninguno queda disminuido: el de la izquierda lanza un tajo alto en diagonal y el de la derecha para con el escudo y contraataca bajo. El tercio superior queda vacío (solo fondo oscuro) para poner un título. Sin chispas, destellos ni efectos en el choque.

Rey de la izquierda (Claude), color terracota/naranja (#D97757):
- Yelmo cerrado de acero que tapa toda la cara. La placa de la cara ES el logo de Claude: copia exactamente la forma de la imagen de referencia assets/brand/claude-symbol.png (mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas), en terracota sobre el acero, grande, ocupando toda la cara. El logo aparece solo ahí, una vez. Corona de oro sencilla encima.
- Escudo de cometa (heater) clásico, bien proporcionado, liso, pintado terracota con un borde de acero limpio y remaches. Lo sujeta firme con el brazo izquierdo, pegado al antebrazo, la mano en la empuñadura. Sin dibujos ni logos.
- Túnica y capa terracota de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Rey de la derecha (Codex), color azul rey:
- Yelmo cerrado de acero liso, elegante, sin dibujos. Corona de oro sencilla encima.
- Escudo con la silueta de un nudo de seis lazos entrelazados (como el logo de OpenAI), forjado en acero con el interior azul. Es el único lugar donde aparece ese símbolo. Lo sostiene firme con el brazo izquierdo.
- Túnica y capa azules de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Armaduras de placas lisas y pulidas; nada de piel de armiño, pelaje, escamas ni cota de malla visible. Estilo: pintura de arte de videojuego de estrategia medieval (tipo Age of Empires II), siluetas claras, contraste fuerte, colores planos y saturados. Formato 16:9, al menos 1536×864. Sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```
```text
Usa tu herramienta integrada image_gen para editar assets/portada-reyes-v7.png y guarda el resultado como PNG en assets/portada-reyes-v8b.png. Adjunta assets/portada-reyes-v7.png y assets/brand/claude-symbol.png (el logo real de Claude).
Cambia solo una cosa: el yelmo del rey de la izquierda (terracota). Su placa de la cara debe SER el logo de Claude, copiado exactamente de assets/brand/claude-symbol.png (mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas), en terracota sobre el acero, grande, ocupando toda la cara. Quita la estrella dorada actual. Todo lo demás queda idéntico: composición, poses, colores, escudos, pasto, fondo, encuadre 16:9, sin texto.
Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```
```text
Usa tu herramienta integrada image_gen para editar assets/portada-reyes-v8b.png y guarda el resultado como PNG en assets/portada-reyes-v9.png. Adjunta assets/portada-reyes-v8b.png y assets/brand/claude-symbol.png (el logo real de Claude).
Cambia solo el yelmo del rey de la izquierda (terracota). La imagen después se reduce a 3 tonos por color (negro, medio, claro), así que el logo tiene que leerse por contraste de luz, no por color:
- La placa de la cara del yelmo es de acero ennegrecido/pavonado, muy oscura.
- Sobre ella, el logo de Claude en relieve de metal claro y brillante (acero pulido con reflejos), grande, ocupando toda la cara, integrado en el yelmo como parte forjada de la armadura (con volumen, bisel y sombra propia, no pegado encima). Copia exactamente la forma de assets/brand/claude-symbol.png: mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas.
Todo lo demás queda idéntico: composición, poses, colores, escudos, corona, pasto, fondo, encuadre 16:9, sin texto.
Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```


# Portada v11: desde cero, yelmo normal y escudo con forma del logo de Claude

```text
Usa tu herramienta integrada image_gen para crear desde cero una ilustración y guárdala como PNG en assets/portada-reyes-v11.png. Adjunta como única imagen de referencia assets/brand/claude-symbol.png (el logo real de Claude); no uses otras referencias.

Escena: dos reyes medievales con armadura completa se enfrentan a espada en una pradera de pasto verde corto, de noche, con fondo azul muy oscuro y liso. Vista lateral, un poco desde arriba, cuerpo entero, los dos del mismo tamaño y a la misma distancia de la cámara. Composición dinámica y asimétrica, pero ninguno queda disminuido: el de la izquierda lanza un tajo alto en diagonal y el de la derecha para con el escudo y contraataca bajo. El tercio superior queda vacío (solo fondo oscuro) para poner un título. Sin chispas, destellos ni efectos en el choque.

Rey de la izquierda (Claude), color terracota/naranja (#D97757):
- Yelmo cerrado de acero liso, elegante, sin dibujos, que tapa toda la cara. Corona de oro sencilla encima.
- El escudo ES el logo de Claude: un escudo con la silueta del asterisco de la imagen de referencia assets/brand/claude-symbol.png (mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas), forjado en acero con el interior esmaltado terracota, del mismo tamaño que el escudo de Codex. Lo sujeta firme con el brazo izquierdo. Es el único lugar donde aparece ese símbolo.
- Túnica y capa terracota de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Rey de la derecha (Codex), color azul rey:
- Yelmo cerrado de acero liso, elegante, sin dibujos. Corona de oro sencilla encima.
- Escudo con la silueta de un nudo de seis lazos entrelazados (como el logo de OpenAI), forjado en acero con el interior azul. Es el único lugar donde aparece ese símbolo. Lo sostiene firme con el brazo izquierdo.
- Túnica y capa azules de tela gruesa y lisa, sin rasgaduras, con un borde dorado fino.

Armaduras de placas lisas y pulidas; nada de piel de armiño, pelaje, escamas ni cota de malla visible. Estilo: pintura de arte de videojuego de estrategia medieval (tipo Age of Empires II), siluetas claras, contraste fuerte, colores planos y saturados. Formato 16:9, al menos 1536×864. Sin texto ni marcas de agua.

Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```

# Portada v11b: edición de v10, yelmo normal y escudo-logo

```text
Usa tu herramienta integrada image_gen para editar assets/portada-reyes-v10.png y guarda el resultado como PNG en assets/portada-reyes-v11b.png. Adjunta assets/portada-reyes-v10.png y assets/brand/claude-symbol.png (el logo real de Claude).
Cambia solo al rey de la izquierda (terracota):
1. Su cabeza vuelve a ser normal: yelmo cerrado de acero liso y elegante que tapa toda la cara, con una corona de oro sencilla encima, igual de sobrio que el del rey azul. Sin rayos ni logo en la cabeza.
2. Su escudo pasa a ser el logo de Claude: la silueta del asterisco de assets/brand/claude-symbol.png (mismos rayos, mismos largos y ángulos irregulares, mismas puntas cortadas), forjado en acero con el interior esmaltado terracota, del mismo tamaño que el escudo-nudo del rey azul, bien sostenido por su brazo izquierdo.
Todo lo demás queda idéntico: composición, poses, espadas, ropa, rey azul, pasto, fondo, encuadre 16:9, sin texto.
Cuando termine, responde solo con la ruta del archivo y su tamaño en píxeles.
```
