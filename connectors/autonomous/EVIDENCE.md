# Validación del jugador con decisiones propias

La implementación actual toma todas las decisiones dentro del jugador. Ya no existen el adaptador de modelos, las llamadas asíncronas, los temas delegables ni sus opciones del CLI. Al migrar checkpoints antiguos, el jugador descarta los consejos externos y recalcula la estrategia local.

Las pruebas actuales y su cantidad exacta están en [tests.json](evidence/tests.json). Cubren construcción efectiva, expansión con ingresos, defensa ante una incursión, puertas, recuperación de rechazos y pérdidas, coordinación y treguas. En escenarios del motor, el jugador decide solo la defensa después de una expansión y la retirada ante una fuerza superior. Una regresión verifica la migración de memoria antigua.

Resultado actual: **18/18 pruebas aprobadas y diez partidas completas**, sin órdenes rechazadas ni errores de scripts. Pasan el typecheck aislado y la comprobación de documentación de reglas. [Comprobaciones y comparación de replays](evidence/checks.json).

La [matriz actual](evidence/matches.json) registra 10 partidas completas con reglas normales y sus hashes de fuentes:

- 8 en 1v1, open/fortress contra rush/eco, desde ambos asientos.
- 1 en 2v2.
- 1 en FFA.

Ninguna acorta su límite. Los replays y las trazas actuales están comprimidos junto al manifiesto.

Los [escenarios](evidence/scenarios.json) separan las condiciones que prepara la prueba de las elecciones del propio jugador. La defensa contra la incursión tiene como control una partida sin construcciones. No implica que esa inversión convenga en cualquier mapa.

La evidencia de la implementación anterior está en [history/with-advisors](evidence/history/with-advisors). Es histórica: sus llamadas a Luna/Haiku y sus pruebas de asesoría no describen el ejecutable actual.

Comprobaciones reproducibles:

```sh
pnpm exec vitest run connectors/autonomous/test
pnpm exec tsc -p connectors/autonomous/tsconfig.json
pnpm exec tsx connectors/autonomous/validate.ts --out /tmp/castellan-local-validation
```

La política mantiene sus limitaciones: apertura vulnerable en terreno abierto, geometría de fortificación simple, pocas semillas y chat estructurado. El typecheck global tiene problemas ajenos al jugador. El typecheck aislado de este directorio permite verificarlo sin cambiar otros componentes.
