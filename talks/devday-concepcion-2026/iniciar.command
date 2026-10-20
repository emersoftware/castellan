#!/bin/zsh
# Doble clic: sirve la charla en http://127.0.0.1:8018 (con Range para video y audio) y abre el navegador.
cd -- "${0:A:h}"
exec python3 servir.py
