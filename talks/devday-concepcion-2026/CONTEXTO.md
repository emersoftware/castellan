# Contexto para editar el deck (2026-10-19)

Charla «Por y para agentes: construyendo un juego de estrategia con Codex y Claude», DevDay Exchange Community: Concepción, 2026-10-20, UDD. 23 min. El usuario es Emerson: responde en español, conciso.

Deck HTML en esta carpeta, servido en http://127.0.0.1:8018 (`python3 servir.py --no-open`). Navegar con `#escena/paso`. No commitear (talks/ no está en git). Respaldo previo a la edición en paralelo: `versiones/v4-antes-de-paralelo/`.

## Reglas de diseño (pedidas por el usuario)
- KISS: sin badges, rótulos ni tags; todo centrado; poco texto, más elementos.
- Fondo negro. Un solo dithering: el del juego (`rampDither` en scenes.js, copia de `packages/web/src/render/dither.ts`), sin grises.
- Sprites a la escala del motor; el mineral es blanco.
- Todo lo que se muestra es real (chats, scripts, partidas). La procedencia va en `source` de `contenido-v2.json`, no en pantalla.

## Motor del deck
- `index.html`: una `<section id>` por escena, `data-steps`, elementos con `data-in`/`data-out`, clases `.ge-N` por paso.
- `scenes.js`: `define(id,{setup,enter,update,leave,frame,onClipReady,onClipTick,onClipSound})`.
- Clips del juego: `window.AOA.mountClip(host,url,{focus,…})` desde `game.js` (fuente `game.ts`, `node build-game.mjs`). Clips en `assets/clips/`, generados con `tools/build-clips.mts`.
- Notas: `node build-notes.mjs` genera `notes.js` desde `contenido-v2.json`. Los ids y el orden deben calzar con index.html y la cantidad de cues con los pasos.
- QA: `node tools/check.mjs` recorre todos los pasos (solo avisos de media abortada son normales).

## Estructura actual (27 escenas, 81 pasos, ~26:15; meta 23 min)
1. Presentación — `intro` (parte en blanco; en «fin de semana» solo el rombo).
2. Intro — `cover` (imagen de Codex `assets/portada-reyes-v11.png` + dithering, título todo del mismo tamaño), `game` (partida real con UI de replay; luego aparecen Claude · Opus 5.5 y Codex · Sol 6.1).
3. Insights de expectativa — `teaser` (treguas, traiciones, mentiras; clips reales).
4. Qué es un RTS — `rts` (ajedrez vs RTS, videos AoE II en `assets/aoe/`), `rules`.
5. Cómo se conectan — `harness` (MCP), `state` (mapa ASCII + extracto literal del state), `thinking` (carrera, llamadas reales, 1,9 s / 83 % / 5:36).
6. Scripts — `scripts` (default del arquero + Grok, Opus, Sol, Gemini, Mistral).
7. Insights detallados (sin decidir si quedan; candidatos a recorte) — `experiments`, `balance`, `turtle`, `diplomacy`, `deception`, `hacks`, `incentives`.
8. Cómo lo construimos — `sprites`, `art`, `music-refs`, `music`, `sounds`, `sound-engine`.
9. Código — `build` (los .md / gdd.md y el chat real con Claude Code).
10. Conclusiones — `fun`, `arena`, `close`.

## Edición en paralelo
Tres agentes editan los mismos archivos (`index.html`, `scenes.js`, `slides.css`). Cada uno toca solo sus escenas. Re-leer el archivo justo antes de cada Edit. Solo el agente de las partes 7-10 toca `contenido-v2.json` y corre `build-notes.mjs`; los demás le dejan cambios de notas en `notas-pendientes.md`.

Historial completo de la sesión anterior (si hace falta un detalle): `~/.claude/projects/-Users-emersoftware-Documents-projects-aoa/f87c8714-521f-4938-bf72-710826dfc69e.jsonl`.
