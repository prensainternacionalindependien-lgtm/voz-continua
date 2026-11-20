# Motor local de voz

El motor utiliza los modelos Pocket TTS de [Kyutai](https://huggingface.co/kyutai/pocket-tts). [Kevin Knoedler (KevinAHM)](https://huggingface.co/spaces/KevinAHM/pocket-tts-web) convirtió los modelos a ONNX. Se utiliza únicamente el conjunto español, en la revisión d0c0c79b7712256a32d691c67f20b8ae2e020d00. Los pesos se descargan de Hugging Face bajo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Se utilizan para inferencia, sin modificar los pesos. Esta aplicación no incluye grabaciones de muestra ni archivos de voces predefinidas.

La implementación del flujo de inferencia deriva de [Pocket Voice, de Hemanth HM](https://github.com/hemanth/pocket-voice/tree/a4496c429f1dcd6ea8faef55a21dc4b7d45636a9), con licencia MIT según el README, y del [código de Kevin Knoedler](https://huggingface.co/spaces/KevinAHM/pocket-tts-web/blob/d0c0c79b7712256a32d691c67f20b8ae2e020d00/README.md), publicado con licencia Apache 2.0. En esta adaptación se sustituyeron la carga del motor y la comunicación del worker, se eliminaron las voces de muestra y se añadió almacenamiento local para los modelos. La muestra del usuario y el texto se procesan en su navegador.

El tokenizador sentencepiece.js se carga de esa revisión exacta de Pocket Voice. Incluye [SentencePiece](https://github.com/google/sentencepiece), bajo Apache 2.0. El motor de ejecución es [ONNX Runtime Web 1.18.0](https://github.com/microsoft/onnxruntime/tree/v1.18.0), de Microsoft, con licencia MIT. Los scripts externos están fijados por revisión o versión y hash de integridad SHA-384. Los textos de las licencias se incluyen a continuación y en Apache-2.0.txt.

## MIT

Copyright (c) Hemanth HM.
Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
