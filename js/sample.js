// Documento de ejemplo que se carga la primera vez.
window.SAMPLE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Documento de ejemplo</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { color: #2c5aa0; }
    .nota { background: #fff8d6; border-left: 4px solid #e0b100; padding: .5rem 1rem; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #ccc; padding: 4px 10px; }
  </style>
</head>
<body>
  <!-- Este comentario, los estilos y el script se conservan al editar visualmente -->
  <h1 class="titulo" id="inicio">¡Hola! Edítame a la izquierda</h1>
  <p>Este es un <strong>editor HTML</strong> con vista <em>visual</em> y de <span style="color: #c0392b;">código</span>.
     Cualquier cambio en un lado se refleja en el otro.</p>
  <p class="nota" data-tipo="aviso">Los <code>&lt;script&gt;</code> no se ejecutan en el editor visual, pero
     <b>no se pierden</b>: usa «Vista previa» para verlos funcionar.</p>
  <ul>
    <li>Prueba el botón <b>🧹 Limpiar…</b> para quitar clases, estilos, etc.</li>
    <li>Usa <b>Formatear</b> para indentar el código.</li>
  </ul>
  <table>
    <tr><th>Columna A</th><th>Columna B</th></tr>
    <tr><td>1</td><td>2</td></tr>
  </table>
  <p><button onclick="saludar()">Pulsa en la vista previa</button></p>
  <script>
    function saludar() {
      alert('¡El script se ha conservado!');
    }
  </script>
</body>
</html>
`;
