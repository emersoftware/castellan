# Segunda prueba de caminata

Esta prueba no corrige lo suficiente la perspectiva para el juego. El ángulo
cambia poco respecto de la primera prueba.

Repetimos la generación con MiniMax H3 desde la sesión local de Hugging Face,
autenticada como `emersoftware`. No copiamos credenciales al proyecto.

Cambios respecto de `../walk-east`:

- Quitamos `side view`.
- Pedimos `FIXED ISOMETRIC VIEW matching the reference exactly`.
- Pedimos cámara ortográfica elevada.
- Pedimos conservar el ángulo y el escorzo de la referencia en todos los cuadros.

Mantuvimos la referencia inicial/final, seed 42, resolución 544 × 544, duración
solicitada de 2 s, 4 pasos, LoRA larry y upsample desactivado.

Resultado verificado: 56 cuadros a 24 fps (2,333 s). La caminata conserva el
arco y la capa. El ángulo cambia poco porque ambas pruebas dependen mucho de la
misma referencia lateral, que además es el cuadro final.

`index.html` compara ambas pruebas. `preview.gif` muestra el video completo de
la segunda. `request.json` guarda el prompt exacto y `result.json` el reporte
del Space. La primera prueba sigue intacta.
