# Validación del jugador con decisiones propias

La implementación actual toma todas las decisiones dentro del jugador. Se retiraron el adaptador de modelos, las llamadas asíncronas, los temas delegables y las opciones correspondientes del CLI. Los checkpoints antiguos se migran descartando consejos externos y recalculando la estrategia local.

Las pruebas actuales y su cantidad exacta están en [tests.json](evidence/tests.json). Cubren construcción efectiva, expansión con ingresos, defensa ante una incursión, puertas, recuperación de rechazos y pérdidas, coordinación y treguas. La defensa posterior a una expansión y la retirada ante una fuerza superior se deciden localmente en escenarios del motor. Una regresión verifica la migración de memoria antigua.

Resultado actual: **18/18 pruebas aprobadas y diez partidas completas**, sin órdenes rechazadas ni errores de scripts. El typecheck aislado y la comprobación de documentación de reglas pasan. [Comprobaciones y comparación de replays](evidence/checks.json).

La [matriz actual](evidence/matches.json) registra diez partidas completas con reglas normales y sus hashes de fuentes: ocho 1v1 en open/fortress contra rush/eco desde ambos asientos, una 2v2 y una FFA. No se acorta el límite de las partidas. Los replays y las trazas actuales se guardan comprimidos junto al manifiesto.

Los [escenarios](evidence/scenarios.json) distinguen condiciones preparadas por la prueba de elecciones hechas por el propio jugador. La defensa contra la incursión se compara con un control sin construcciones; no implica que esa inversión sea rentable en cualquier mapa.

La evidencia de la implementación anterior se conserva en [history/with-advisors](evidence/history/with-advisors). Es histórica: sus llamadas a Luna/Haiku y pruebas de asesoría no describen el ejecutable actual.

Comprobaciones reproducibles:

```sh
pnpm exec vitest run connectors/autonomous/test
pnpm exec tsc -p connectors/autonomous/tsconfig.json
pnpm exec tsx connectors/autonomous/validate.ts --out /tmp/aoa-local-validation
```

Siguen vigentes las limitaciones de la política: apertura vulnerable en terreno abierto, geometría de fortificación simple, pocas semillas y chat estructurado. El typecheck global tiene problemas ajenos al jugador; el typecheck aislado de este directorio permite verificarlo sin modificar otros componentes.
