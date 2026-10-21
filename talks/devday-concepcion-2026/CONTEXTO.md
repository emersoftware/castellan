# Contexto para editar el deck (2026-10-19)

Charla «Por y para agentes: construyendo un juego de estrategia con Codex y Claude». DevDay Exchange Community: Concepción, 2026-10-20, UDD. Dura 23 min. El usuario es Emerson: responde en español, conciso.

`python3 servir.py --no-open` sirve el deck en http://127.0.0.1:8018. Navega con `#escena/paso`. No hagas commit (talks/ ya está en git). Respaldo previo a la edición en paralelo: `versiones/v4-antes-de-paralelo/`.

## Reglas de diseño (pedidas por el usuario)
- KISS (simple): sin badges, rótulos ni tags. Todo centrado. Poco texto, más elementos.
- Fondo negro. Un solo dithering, el del juego: `rampDither` en scenes.js, copia de `packages/web/src/render/dither.ts`. Sin grises.
- Sprites a la escala del motor. El mineral es blanco.
- Todo es real: chats, scripts y partidas. La procedencia va en `source` de `contenido-v2.json`, no en pantalla.

## Motor del deck
- `index.html`: una `<section id>` por escena con `data-steps`. Elementos con `data-in`/`data-out` y clases `.ge-N` por paso.
- `scenes.js`: `define(id,{setup,enter,update,leave,frame,onClipReady,onClipTick,onClipSound})`.
- Clips del juego: `window.AOA.mountClip(host,url,{focus,…})` desde `game.js` (fuente `game.ts`, `node build-game.mjs`). `tools/build-clips.mts` genera los clips en `assets/clips/`.
- Notas: `node build-notes.mjs` genera `notes.js` desde `contenido-v2.json`. Ids y orden deben calzar con index.html. Los cues deben calzar con los pasos.
- QA: `node tools/check.mjs` recorre todos los pasos. Los avisos de media abortada son normales.

## Estructura actual (30 escenas, 76 pasos, 1400 s; meta 23 min)
Orden de `index.html` (pasos):

1. `intro` (5): presentación en blanco; en «fin de semana» solo el rombo.
2. `cover` (2): imagen de Codex `assets/portada-reyes-v11.png` con dithering.
3. `game` (2): partida real con UI de replay; luego Opus, Sol, Fable y Astra.
4. `teaser` (3): treguas, traiciones y mentiras, clips reales.
5. `rts` (2): qué es un RTS; videos AoE II en `assets/aoe/`.
6. `basics` (8), 7. `pov` (3), 8. `king-down` (1): qué hace y qué recibe un jugador.
9. `harness` (4): conexión por MCP. 10. `state` (2). 11. `thinking` (1).
12. `experiments` (2), 13. `balance` (1), 14. `turtle` (1), 15. `diplomacy` (2), 16. `deception` (8), 17. `hacks` (1): insights.
18. `scripts` (3): default del arquero, Claude (Fable 5.1) y Codex (Sol 6.1).
19. `final-verdict` (1), 20. `gameplay` (1).
21. `build` (4): los .md (gdd.md) y el chat real con Claude Code.
22. `sprites` (3), 23. `art` (5), 24. `music-refs` (2), 25. `music` (2), 26. `sounds` (1), 27. `sound-engine` (1).
28. `fight` (1), 29. `lab` (2): experimentos. 30. `close` (2).

## Edición en paralelo
Tres agentes editan `index.html`, `scenes.js` y `slides.css`. Cada uno toca solo sus escenas. Relee el archivo antes de cada Edit. Solo el agente de las partes 7-10 toca `contenido-v2.json` y corre `build-notes.mjs`. Los demás le dejan cambios de notas en `notas-pendientes.md`.

Historial de la sesión anterior: `~/.claude/projects/-Users-emersoftware-Documents-projects-aoa/f87c8714-521f-4938-bf72-710826dfc69e.jsonl`.
