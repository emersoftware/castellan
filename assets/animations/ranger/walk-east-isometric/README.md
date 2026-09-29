# Segunda prueba de caminata

Se repitió la generación con MiniMax H3 desde la sesión local de Hugging Face
autenticada como `emersoftware`. No se copiaron credenciales al proyecto.

Cambio respecto de `../walk-east`: se quitó `side view` y se pidió explícitamente
`FIXED ISOMETRIC VIEW matching the reference exactly`, cámara ortográfica elevada
y conservación del ángulo y el escorzo de la referencia en todos los cuadros.
Se mantuvieron la referencia inicial/final, seed 42, resolución 544 × 544,
duración solicitada de 2 s, 4 pasos, LoRA larry y upsample desactivado.

Resultado verificado: 56 cuadros a 24 fps (2,333 s). La secuencia muestra una
caminata con arco y capa conservados. El cambio del ángulo respecto de la
primera prueba es pequeño: ambas siguen muy condicionadas por la misma
referencia lateral y por usarla también como cuadro final. No se considera
validada una corrección suficiente de la perspectiva para el juego.

Abrir `index.html` para comparar ambas pruebas. `preview.gif` muestra el video
completo de la segunda. `request.json` conserva el prompt exacto y `result.json`
el reporte del Space. La primera prueba se conserva sin reemplazar.
