# Árbol de la Vida

**Ancestro común más cercano sobre la taxonomía real de NCBI**, visualizado como un árbol tridimensional navegable.

![Vista general](docs/capturas/portada.png)

---

## 1. El caso de estudio

> Dos especies. ¿Cuál es su antepasado compartido más reciente?

En biología evolutiva esa pregunta se responde con el **LCA** (*lowest common ancestor*, ancestro común más cercano) y es la operación fundamental de la taxonomía comparada: sirve para saber cuándo se separaron dos linajes, para clasificar un taxón nuevo o para detectar si dos secuencias pertenecen al mismo grupo.

La aplicación resuelve la pregunta sobre la **taxonomía oficial de NCBI** (3.024.644 taxones en el volcado original) y muestra el proceso, no solo el resultado: los dos linajes ascienden por el árbol, se ve cada salto y, al encontrarse, aparece el ancestro con su rango y su profundidad.

Ejemplos que el sistema responde al instante:

| Especie A | Especie B | Ancestro común |
|---|---|---|
| *Homo sapiens* | *Amanita muscaria* | **Opisthokonta** (clado) |
| *Homo sapiens* | *Mus musculus* | **Euarchontoglires** |
| *Homo sapiens* | *Arabidopsis thaliana* | **Eukaryota** |
| *Homo sapiens* | *Escherichia coli* | **cellular organisms** |
| *Homo sapiens* | *Pan troglodytes* | **Homininae** |

---

## 2. Tipo de estructura

> **Árbol n-ario enraizado, no ordenado, con politomías.**

Propiedades que lo definen y que descartan otras estructuras:

- **N-ario**: un nodo puede tener 2, 3 o hasta **166 hijos**. No es un árbol binario.
- **No ordenado**: no existe una clave que ordene a los hijos. **No es un árbol binario de búsqueda (ABB)**; no hay comparaciones `<`/`>` ni recorridos in-orden con sentido.
- **Con politomías**: hay nodos con más de dos descendientes directos, algo habitual en taxonomía.
- **Enraizado**: un único nodo raíz (`taxid 1`, "root") del que cuelga todo.
- **Estático**: el árbol no se modifica en caliente — se construye una vez y se consulta muchas veces. Por eso el esfuerzo se pone en el **preprocesamiento**, no en el balanceo.

### Estructuras auxiliares

| Estructura | Para qué | Coste |
|---|---|---|
| Árbol n-ario (hijos + padre + profundidad) | esqueleto del dominio | construcción **O(n)** |
| **Tabla de saltos binarios** (*binary lifting*) | responder el LCA | preproceso **O(n log n)** · consulta **O(log n)** |
| **Trie** de nombres | autocompletado por prefijo | **O(k)** con *k* = longitud del prefijo |

### Por qué *binary lifting* y no otra cosa

Subir rama por rama hasta que los dos caminos coincidan cuesta **O(h)**, con *h* = altura del árbol (35 niveles en este dataset). Con saltos binarios se precalcula, para cada nodo, su ancestro número 1, 2, 4, 8, 16… y una consulta se resuelve en **O(log n) ≈ 6 lecturas**.

Es además la estructura que mejor se **anima**: cada salto es un desplazamiento visible de 2^k ancestros, así que el contraste entre "subir paso a paso" y "saltar" se entiende sin leer una sola línea de código.

```
nivel 0   1  (root)
           \
nivel 1    131567  cellular organisms
                 \
nivel 2           2759  Eukaryota
                       \
                       33154  Opisthokonta   ← LCA (Homo sapiens, Amanita muscaria)
                       /      \
                  33208      4751
                  Metazoa    Fungi
```

---

## 3. Cómo se resuelve

```
index_a ─┐
         ├─ igualar profundidades con saltos de 2^k
index_b ─┘
         ↓
   ¿son el mismo nodo? ── sí ──► ese es el LCA
         ↓ no
   para k = log..0: si ancestro_k(a) ≠ ancestro_k(b), subir ambos
         ↓
   el padre común es el LCA
```

Complejidades medidas en este dataset (25.183 nodos, profundidad 35):

| | Ingenuo | Optimizado |
|---|---|---|
| Preproceso | — | O(n log n) → tabla de 604 KB |
| Consulta | O(h) = hasta 35 pasos | O(log n) = 6 niveles |
| Ejemplo real (*Homo sapiens* vs *Amanita muscaria*) | **39 pasos** | **8 saltos** |

---

## 4. Interfaz

Tres capas conviven en pantalla:

1. **El árbol 3D**: layout radial por profundidad, cada rama con su propio sector angular proporcional a su cantidad de hojas. Se **despliega haciendo clic** en un nodo, para que 25.000 taxones quepan en una vista legible.
2. **La consulta**: buscador con autocompletado (trie del backend), selector de modo **Optimizado / Ingenuo** y botón de **reto aleatorio**.
3. **El resultado**: ancestro, rango, profundidad y comparación de coste entre los dos modos.

Animaciones:

- crecimiento del árbol al desplegar una rama;
- cometas que recorren cada salto del linaje (ámbar para A, verde agua para B);
- onda expansiva en el nodo donde se encuentran;
- la cámara vuela hasta el ancestro común.

Atajos: **Enter** resuelve, **Esc** cierra el resultado, **doble clic** en el vacío reencuadra la cámara.

---

---

Proyecto de Estructuras de Datos · Cuarto Semestre<br>
Código en inglés, interfaz y documentación en español.
