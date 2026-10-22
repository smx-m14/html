# Editor HTML

Editor HTML con vista visual (WYSIWYG) a la izquierda y código a la derecha, sincronizados en ambos sentidos.

Abre `index.html` en Chrome o Edge. Necesita conexión a internet para cargar CodeMirror y js-beautify desde cdnjs.

## Cómo se conserva todo el HTML

- El editor visual es un `<iframe sandbox="allow-same-origin">` sin `allow-scripts`. Los `<script>` y los atributos `on*` se cargan en el DOM, pero no se ejecutan.
- Se edita con `designMode`, que no añade atributos al documento.
- Al sincronizar se serializa el documento completo: doctype, comentarios, `<head>` (estilos, scripts, metas) y `<body>`.
- Si el código es un fragmento (sin `<html>` ni `<body>`), se sigue guardando como fragmento.
- **▶ Vista previa** abre el documento en una pestaña nueva, con los scripts activos.

## Funciones

- **Archivos:** nuevo, abrir, guardar (sobre el mismo archivo en Chrome/Edge) y guardar como. También puedes arrastrar un archivo a la ventana. El documento se guarda automáticamente en el navegador.
- **Visual:** bloques (párrafo, títulos, cita…), negrita/cursiva/etc., colores, listas, alineación, enlaces, imágenes, tablas, quitar formato. La ruta de elementos en la barra inferior permite seleccionar o eliminar el elemento padre.
- **Código:** resaltado, plegado, buscar y reemplazar, cierre automático de etiquetas, formatear (Shift+Alt+F).
- **Emmet:** escribe una abreviatura y pulsa Tab (`p` → `<p></p>`, `ul>li*3`, `div.caja#principal`, `a[href=#]{Enlace}`). Esc la descarta y Ctrl+Espacio captura una abreviatura ya escrita. Más atajos: Ctrl+/ comentar, Shift+Ctrl+A envolver con abreviatura, Shift+Ctrl+K quitar etiqueta.
- **🧹 Limpiar:** quita `class`, `style`, `id`, `data-*`, `aria-*`, eventos, atributos obsoletos, `<script>`, `<style>`, comentarios, `<span>`, `<font>`, etiquetas vacías, `&nbsp;` y restos de Word, o convierte el documento a texto plano. Incluye preajustes y se deshace con Ctrl+Z en el editor de código.

## Estructura

- `index.html`: interfaz
- `css/styles.css`: estilos
- `js/app.js`: sincronización, barras de herramientas y archivos
- `js/cleaner.js`: serialización sin pérdidas y operaciones de limpieza
- `js/sample.js`: documento de ejemplo
