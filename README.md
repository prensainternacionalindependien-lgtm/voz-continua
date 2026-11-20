# Voz Continua

[Abrir Voz Continua en el iPhone](https://prensainternacionalindependien-lgtm.github.io/voz-continua/)

Aplicación web en español para iPhone. Graba una muestra propia, pega el texto entero y pulsa **Generar con mi voz**. La app sintetiza y guarda el resultado por fragmentos. El campo de texto no tiene un máximo configurado. El tiempo de generación, la memoria y el espacio disponible sí limitan el tamaño práctico de una narración.

**En mi dispositivo** utiliza Pocket TTS en español. El primer uso descarga unos 160 MB de modelos y dependencias. El navegador procesa la grabación y el texto localmente. No hay cuenta, créditos ni clave de API. Mantén Safari abierto durante la generación. Si se interrumpe, la app permite continuar desde el último fragmento terminado en ese navegador.

**En línea · Chatterbox** envía la muestra y el texto por partes a la demo pública de español latino de Resemble AI en Hugging Face. La demo controla su disponibilidad y su cuota gratuita. La app conserva las partes terminadas cuando la demo falla o agota la cuota.

En **Tu narración** puedes reproducir los fragmentos seguidos o preparar un archivo WAV con todo el audio terminado. Para narraciones muy grandes, la descarga se reparte en volúmenes de hasta unos 128 MB. Una nueva generación reemplaza el resultado anterior. La muestra, el texto y el progreso viven en IndexedDB en el navegador que uses.

## Ejecutar el proyecto

En el repositorio de GitHub, los archivos web están en la raíz. Ejecuta `python3 -m http.server 8080` y abre `http://localhost:8080`. Para usar el micrófono desde un iPhone, aloja esos mismos archivos por HTTPS, por ejemplo con GitHub Pages. No se necesita un proceso de compilación.

## Licencias

La aplicación usa MIT. Las atribuciones del motor local y las licencias de las dependencias se encuentran en [local/THIRD-PARTY.md](local/THIRD-PARTY.md). Los pesos de Pocket TTS se distribuyen bajo CC BY 4.0. El modo en línea se conecta al proyecto [Chatterbox](https://github.com/resemble-ai/chatterbox).
