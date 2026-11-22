# 5A.6 — Ayuda contextual local

Estado: **implementado, pendiente de CI y de revisión del propietario**. Solo laboratorio.
Rama `desarrollo/etapa-5a6`, sobre `desarrollo/etapa-5a5`. Decisiones provisionales P-5A6-1
a P-5A6-3 en [DECISIONES_PROVISIONALES.md](../DECISIONES_PROVISIONALES.md).

## Qué añade

- **Página `/ayuda`** («Ayuda» en la navegación):
  - 17 temas versionados (`HELP_VERSION`).
  - Se filtran por rol (pasajero, chofer, administración o para todos) y con una búsqueda que ignora acentos.
  - Cada tema indica si es información, incidencia o algo que requiere revisión, y enlaza solo a páginas internas.
- **Enlaces contextuales** desde «Mis reservas», «Chofer» y «Administración» hacia la ayuda de su rol (`/ayuda?para=…`).
- **Navegación:** `go()` enruta por pathname y conserva la query. Antes, una URL con query mostraba «Página no encontrada».
- **Sin servidor ni migración.** La ayuda no hace peticiones ni escrituras, y se lee sin red una vez cargada la página.

## Pruebas

| Prueba | Qué verifica |
| --- | --- |
| `5A6-U1` | Temas bien formados con ids únicos, enlaces solo internos y existentes, sin URLs ni scripts, y al menos un tema de cada rol y de cada tipo. |
| `5A6-U2` | No promete llamadas, avisos, plazos, garantías ni líneas de atención. SMS, correo y llamadas solo se mencionan para decir que el laboratorio no los usa. |
| `5A6-U3` | Filtro por rol, búsqueda sin acentos y ayuda por página. |
| `5A6-E1` | Filtro y búsqueda reales, sin peticiones a `/api/` (salvo la sesión), con axe y sin desbordamiento. |
| `5A6-E2` | El enlace contextual abre la ayuda del rol, y la ayuda funciona y navega sin red una vez cargada. |

**No ejecutadas en local** (la sesión no tiene npm). La batería completa la cubre el CI del PR.

## Límites

Los textos son provisionales (P-5A6-2) y deben revisarse con la asociación compradora.
