/* Spanish custom-voice inference adapted from hemanth/pocket-voice and KevinAHM.
 * Attribution and dependency licenses are in THIRD-PARTY.md.
 * Classic script in a same-origin iframe, which gives each engine its own runtime.
 */
const MODEL_BASE = "https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/d0c0c79b7712256a32d691c67f20b8ae2e020d00/onnx/spanish/";
const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";
const LSD_STEPS = 1;
const MAX_FRAMES = 500;
const CHUNK_GAP_SEC = 0.25;
const RESET_FLOW_STATE_EACH_CHUNK = true;
const RESET_MIMI_STATE_EACH_CHUNK = true;
let bundleMetadata, tokenizerProcessor, bosBeforeVoice, customVoiceEmbedding;
let mimiEncoderSession, textConditionerSession, flowLmMainSession, flowLmFlowSession, mimiDecoderSession;
let currentSampleRate, currentSamplesPerFrame, currentLatentDim, currentConditioningDim, currentMaxTokenPerChunk;
let stTensors = [];
let voiceConditioningCache = new Map();
let isGenerating = false;
let report = () => {};
let outputBlocks = [];
let modelCache;
function sessionOptions() {
    // Load sessions in order with bounded native heap growth on iPhone.
    return {executionProviders: ["wasm"], graphOptimizationLevel: "disabled", enableCpuMemArena: false, enableMemPattern: false};
}
async function modelFile(name) {
    const url = MODEL_BASE + name;
    if (modelCache) {
        try {
            const cached = await modelCache.match(url);
            if (cached) return cached;
        } catch { /* Storage permissions can change in private browsing. */ }
    }
    let response = await fetch(url, {credentials: "omit"});
    if (!response.ok) throw new Error("No se pudo descargar " + name + " (HTTP " + response.status + ").");
    if (modelCache) {
        try {
            // Store the response stream before reading it, avoiding a second full in-memory copy.
            await modelCache.put(url, response);
            const saved = await modelCache.match(url);
            if (saved) return saved;
        } catch { /* The voice engine can still run when storage is full. */ }
        if (response.bodyUsed) response = await fetch(url, {credentials: "omit"});
        if (!response.ok) throw new Error("No se pudo volver a descargar " + name + ".");
    }
    return response;
}
async function session(name) {
    const bytes = await (await modelFile(name)).arrayBuffer();
    return ort.InferenceSession.create(bytes, sessionOptions());
}

function makeFilledArray(shape, dtype, fill) {
    const size = shape.reduce((a, b) => a * b, 1);
    let data;

    if (dtype === "int64") {
        data = new BigInt64Array(size);
    } else if (dtype === "bool") {
        data = new Uint8Array(size);
    } else {
        data = new Float32Array(size);
        if (fill === "nan") {
            data.fill(NaN);
        } else if (fill === "ones") {
            data.fill(1);
        }
    }

    return data;
}

function createTensor(dtype, data, dims) {
    return new ort.Tensor(dtype, data, dims);
}

function initStateFromManifest(manifest) {
    const state = {};
    for (const entry of manifest) {
        state[entry.input_name] = createTensor(
            entry.dtype,
            makeFilledArray(entry.shape, entry.dtype, entry.fill),
            entry.shape
        );
    }
    return state;
}

function cloneState(state) {
    return { ...state };
}

function updateStateFromManifestOutputs(state, result, manifest) {
    for (const entry of manifest) {
        state[entry.input_name] = result[entry.output_name];
    }
}


function prepareVoiceEmbeddingData(voiceEmb) {
    let data = voiceEmb.data;
    let dims = voiceEmb.shape.slice();

    if (bundleMetadata.insert_bos_before_voice && bosBeforeVoice) {
        const bosData = bosBeforeVoice.data;
        const combined = new Float32Array(bosData.length + data.length);
        combined.set(bosData, 0);
        combined.set(data, bosData.length);
        data = combined;
        dims = [1, dims[1] + bosBeforeVoice.shape[1], dims[2]];
    }

    return createTensor("float32", data, dims);
}

async function buildVoiceConditionedState(voiceEmb) {
    const flowLmState = initStateFromManifest(bundleMetadata.flow_lm_state_manifest);
    const emptySeq = createTensor("float32", new Float32Array(0), [1, 0, currentLatentDim]);
    const voiceTensor = prepareVoiceEmbeddingData(voiceEmb);

    const result = await flowLmMainSession.run({
        sequence: emptySeq,
        text_embeddings: voiceTensor,
        ...flowLmState,
    });

    updateStateFromManifestOutputs(flowLmState, result, bundleMetadata.flow_lm_state_manifest);
    return flowLmState;
}


function parseNpyFloat32(buffer) {
    const view = new DataView(buffer);
    const magic = new Uint8Array(buffer, 0, 6);
    const expected = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
    for (let i = 0; i < expected.length; i++) {
        if (magic[i] !== expected[i]) {
            throw new Error("Invalid NPY file");
        }
    }

    const major = view.getUint8(6);
    const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
    const headerOffset = major === 1 ? 10 : 12;
    const headerText = new TextDecoder().decode(new Uint8Array(buffer, headerOffset, headerLen));
    const shapeMatch = headerText.match(/\(\s*([0-9,\s]+)\)/);
    if (!shapeMatch) {
        throw new Error("Could not parse NPY shape");
    }
    const shape = shapeMatch[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => Number.parseInt(part, 10));
    const dataOffset = headerOffset + headerLen;
    const data = new Float32Array(buffer, dataOffset);
    return { data: new Float32Array(data), shape };
}


async function encodeVoiceAudio(audioData) {
    if (!mimiEncoderSession) mimiEncoderSession = await session("mimi_encoder_int8.onnx");
    const input = createTensor("float32", new Float32Array(audioData), [1, 1, audioData.length]);
    const outputs = await mimiEncoderSession.run({ audio: input });
    const embeddings = outputs[mimiEncoderSession.outputNames[0]];

    let dims = embeddings.dims.slice();
    let data = new Float32Array(embeddings.data);
    while (dims.length > 3) {
        if (dims[0] !== 1) break;
        dims = dims.slice(1);
    }
    if (dims.length < 3) {
        dims = [1, dims[0], dims[1]];
    }

    return { data, shape: dims };
}

function prepareTextPrompt(text) {
    let prompt = text.trim()
        .replace(/\bDra\.(?=\s|$)/gu, "doctora")
        .replace(/\bDr\.(?=\s|$)/gu, "doctor")
        .replace(/\bSra\.(?=\s|$)/gu, "señora")
        .replace(/\bSr\.(?=\s|$)/gu, "señor")
        .replace(/\bUd\.(?=\s|$)/gu, "usted")
        .replace(/\bUds\.(?=\s|$)/gu, "ustedes")
        .replace(/\bp\.\s*ej\.(?=\s|$)/giu, "por ejemplo");
    if (!prompt) {
        return { text: "", framesAfterEos: 1 };
    }

    prompt = prompt.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ");
    if (bundleMetadata.remove_semicolons) {
        prompt = prompt.replace(/;/g, ",");
    }

    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    let framesAfterEos = wordCount <= 4 ? 5 : 3;
    if (bundleMetadata.model_recommended_frames_after_eos != null) {
        framesAfterEos = Number(bundleMetadata.model_recommended_frames_after_eos);
    }

    if (prompt && !/[A-ZÀ-Þ]/.test(prompt[0])) {
        prompt = prompt[0].toUpperCase() + prompt.slice(1);
    }
    if (prompt && /[0-9A-Za-zÀ-ÿ]/.test(prompt[prompt.length - 1])) {
        prompt += ".";
    }
    if (bundleMetadata.pad_with_spaces_for_short_inputs && wordCount < 5) {
        prompt = "        " + prompt;
    }

    return { text: prompt, framesAfterEos };
}

const SENTENCE_SPLIT_RE = /[^.!?]+[.!?]+|[^.!?]+$/g;

function splitTextIntoSentences(text) {
    const matches = text.match(SENTENCE_SPLIT_RE);
    if (!matches) return [];
    return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function splitTokenIdsIntoChunks(tokenIds, maxTokens) {
    const chunks = [];
    for (let i = 0; i < tokenIds.length; i += maxTokens) {
        const chunkText = tokenizerProcessor.decodeIds(tokenIds.slice(i, i + maxTokens)).trim();
        if (chunkText) {
            chunks.push(chunkText);
        }
    }
    return chunks;
}

function splitIntoBestSentences(text) {
    const prepared = prepareTextPrompt(text);
    if (!prepared.text) {
        return { chunks: [], framesAfterEos: prepared.framesAfterEos };
    }

    const sentences = splitTextIntoSentences(prepared.text);
    if (!sentences.length) {
        return { chunks: [prepared.text], framesAfterEos: prepared.framesAfterEos };
    }

    const chunks = [];
    let currentChunk = "";

    for (const sentenceText of sentences) {
        const sentenceTokenIds = tokenizerProcessor.encodeIds(sentenceText);
        const sentenceTokens = sentenceTokenIds.length;

        if (sentenceTokens > currentMaxTokenPerChunk) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }
            const splitChunks = splitTokenIdsIntoChunks(sentenceTokenIds, currentMaxTokenPerChunk);
            for (const splitChunk of splitChunks) {
                if (splitChunk) {
                    chunks.push(splitChunk.trim());
                }
            }
            continue;
        }

        if (!currentChunk) {
            currentChunk = sentenceText;
            continue;
        }

        const combined = `${currentChunk} ${sentenceText}`;
        const combinedTokens = tokenizerProcessor.encodeIds(combined).length;
        if (combinedTokens > currentMaxTokenPerChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = sentenceText;
        } else {
            currentChunk = combined;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return { chunks, framesAfterEos: prepared.framesAfterEos };
}

function precomputeFlowBuffers() {
    stTensors = [];
    const dt = 1.0 / LSD_STEPS;
    for (let step = 0; step < LSD_STEPS; step++) {
        const s = step / LSD_STEPS;
        const t = s + dt;
        stTensors.push({
            s: createTensor("float32", new Float32Array([s]), [1, 1]),
            t: createTensor("float32", new Float32Array([t]), [1, 1]),
        });
    }
}


async function load(onStatus) {
    report = onStatus;
    try { modelCache = await self.caches?.open("voz-es-pocket-tts-d0c0c79-v1"); }
    catch { modelCache = null; }

    if (!globalThis.ort || !globalThis.SentencePieceProcessor) throw new Error("Safari no pudo cargar los componentes de voz. Revisa la conexión y vuelve a intentar.");
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = "error";
    precomputeFlowBuffers();
    report("Descargando el modelo de español…");
    bundleMetadata = await (await modelFile("bundle.json")).json();
    currentSampleRate = Number(bundleMetadata.sample_rate);
    currentSamplesPerFrame = Number(bundleMetadata.samples_per_frame);
    currentLatentDim = Number(bundleMetadata.latent_dim);
    currentConditioningDim = Number(bundleMetadata.conditioning_dim);
    currentMaxTokenPerChunk = Number(bundleMetadata.max_token_per_chunk || 50);
    if (currentSampleRate !== 24000) throw new Error("Frecuencia de audio incompatible.");
    tokenizerProcessor = new self.SentencePieceProcessor();
    await tokenizerProcessor.loadFromArrayBuffer(await (await modelFile(bundleMetadata.tokenizer_file)).arrayBuffer());
    if (bundleMetadata.bos_before_voice_file) bosBeforeVoice = parseNpyFloat32(await (await modelFile(bundleMetadata.bos_before_voice_file)).arrayBuffer());
    report("Preparando el modelo de español (1 de 4)…");
    textConditionerSession = await session("text_conditioner_int8.onnx");
    report("Preparando el modelo de español (2 de 4)…");
    flowLmMainSession = await session("flow_lm_main_int8.onnx");
    report("Preparando el modelo de español (3 de 4)…");
    flowLmFlowSession = await session("flow_lm_flow_int8.onnx");
    report("Preparando el modelo de español (4 de 4)…");
    mimiDecoderSession = await session("mimi_decoder_int8.onnx");
}
async function setVoice(audioData) {
    voiceConditioningCache.clear();
    customVoiceEmbedding = null;
    if (!audioData?.length) throw new Error("Falta grabar tu voz.");
    report("Reconociendo tu voz…");
    try {
        customVoiceEmbedding = await encodeVoiceAudio(audioData);
        const state = await buildVoiceConditionedState(customVoiceEmbedding);
        voiceConditioningCache.set("custom", state);
    } finally {
        if (mimiEncoderSession) {
            await mimiEncoderSession.release();
            mimiEncoderSession = null;
        }
        customVoiceEmbedding = null;
    }
}
async function generate(text) {
    if (!voiceConditioningCache.has("custom")) throw new Error("Primero graba o selecciona tu propia voz.");
    const {chunks, framesAfterEos} = splitIntoBestSentences(text);
    if (!chunks.length) throw new Error("Falta el texto que quieres escuchar.");
    outputBlocks = [];
    isGenerating = true;
    try {
        await runGenerationPipeline("custom", chunks, framesAfterEos);
        const total = outputBlocks.reduce((size, part) => size + part.length, 0);
        if (!total) throw new Error("El motor no produjo audio.");
        const pcm = new Float32Array(total);
        let offset = 0;
        for (const part of outputBlocks) { pcm.set(part, offset); offset += part.length; }
        return pcm;
    } finally {
        isGenerating = false;
        outputBlocks = [];
    }
}
globalThis.VozMotor = {load, setVoice, generate, cancel(){isGenerating = false;}};

async function runGenerationPipeline(voiceName, chunks, framesAfterEos) {
    let mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
    const emptySeq = createTensor("float32", new Float32Array(0), [1, 0, currentLatentDim]);
    const emptyTextEmb = createTensor("float32", new Float32Array(0), [1, 0, currentConditioningDim]);
    const baseFlowState = voiceConditioningCache.get(voiceName);
    if (!baseFlowState) {
        throw new Error(`Voice conditioning cache missing for '${voiceName}'.`);
    }
    let flowLmState = cloneState(baseFlowState);

    const normalChunkFrames = 12;

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (!isGenerating) break;

        if (RESET_FLOW_STATE_EACH_CHUNK && chunkIdx > 0) {
            flowLmState = cloneState(baseFlowState);
        }
        if (RESET_MIMI_STATE_EACH_CHUNK && chunkIdx > 0) {
            mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
        }

        const chunkText = chunks[chunkIdx];
        const tokenIds = tokenizerProcessor.encodeIds(chunkText);
        const minimumFrames = Math.min(60, Math.floor(chunkText.trim().length / 3));
        const textInput = createTensor(
            "int64",
            BigInt64Array.from(tokenIds.map((token) => BigInt(token))),
            [1, tokenIds.length]
        );

        let textEmb = (await textConditionerSession.run({ token_ids: textInput }))[textConditionerSession.outputNames[0]];
        if (textEmb.dims.length === 2) {
            textEmb = createTensor("float32", new Float32Array(textEmb.data), [1, textEmb.dims[0], textEmb.dims[1]]);
        }

        const condResult = await flowLmMainSession.run({
            sequence: emptySeq,
            text_embeddings: textEmb,
            ...flowLmState,
        });
        updateStateFromManifestOutputs(flowLmState, condResult, bundleMetadata.flow_lm_state_manifest);

        const chunkLatents = [];
        let chunkDecodedFrames = 0;
        let currentLatent = createTensor("float32", new Float32Array(currentLatentDim).fill(NaN), [1, 1, currentLatentDim]);
        let eosStep = null;
        let chunkEnded = false;

        for (let step = 0; step < MAX_FRAMES; step++) {
            if (!isGenerating) break;
            if (step > 0 && step % 4 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            const arResult = await flowLmMainSession.run({
                sequence: currentLatent,
                text_embeddings: emptyTextEmb,
                ...flowLmState,
            });

            const conditioning = arResult.conditioning;
            const eosLogit = arResult.eos_logit.data[0];
            // An early stop on the first frames can turn a full phrase into a short click.
            const isEos = step >= minimumFrames && eosLogit > -4.0;
            if (isEos && eosStep == null) {
                eosStep = step;
            }
            const shouldStop = eosStep != null && step >= eosStep + framesAfterEos;

            const temperature = 0.3;
            const std = Math.sqrt(temperature);
            const latentData = new Float32Array(currentLatentDim);
            for (let i = 0; i < currentLatentDim; i++) {
                let u = 0;
                let v = 0;
                while (u === 0) u = Math.random();
                while (v === 0) v = Math.random();
                latentData[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * std;
            }

            const dt = 1.0 / LSD_STEPS;
            for (let lsdIndex = 0; lsdIndex < LSD_STEPS; lsdIndex++) {
                const flowResult = await flowLmFlowSession.run({
                    c: conditioning,
                    s: stTensors[lsdIndex].s,
                    t: stTensors[lsdIndex].t,
                    x: createTensor("float32", latentData, [1, currentLatentDim]),
                });
                const flowDir = flowResult.flow_dir.data;
                for (let i = 0; i < currentLatentDim; i++) {
                    latentData[i] += flowDir[i] * dt;
                }
            }

            chunkLatents.push(new Float32Array(latentData));
            currentLatent = createTensor("float32", latentData, [1, 1, currentLatentDim]);
            updateStateFromManifestOutputs(flowLmState, arResult, bundleMetadata.flow_lm_state_manifest);

            const pending = chunkLatents.length - chunkDecodedFrames;
            let decodeSize = 0;
            if (shouldStop) {
                decodeSize = pending;
            } else if (pending >= normalChunkFrames) {
                decodeSize = normalChunkFrames;
            }

            if (decodeSize > 0) {
                const decodeLatents = new Float32Array(decodeSize * currentLatentDim);
                for (let frame = 0; frame < decodeSize; frame++) {
                    decodeLatents.set(chunkLatents[chunkDecodedFrames + frame], frame * currentLatentDim);
                }

                const decodeResult = await mimiDecoderSession.run({
                    latent: createTensor("float32", decodeLatents, [1, decodeSize, currentLatentDim]),
                    ...mimiState,
                });

                for (const entry of bundleMetadata.mimi_state_manifest) {
                    mimiState[entry.input_name] = decodeResult[entry.output_name];
                }

                chunkDecodedFrames += decodeSize;
                const audioFloat32 = new Float32Array(decodeResult[mimiDecoderSession.outputNames[0]].data);

                outputBlocks.push(audioFloat32);
            }

            if (shouldStop) {
                chunkEnded = true;
                break;
            }
        }

        if (isGenerating && !chunkEnded) {
            throw new Error("El motor no terminó una frase. Prueba con frases más cortas.");
        }
        if (chunkEnded && isGenerating && chunkIdx < chunks.length - 1) {
            const gapSamples = Math.max(1, Math.floor(CHUNK_GAP_SEC * currentSampleRate));
            const silence = new Float32Array(gapSamples);
            outputBlocks.push(silence);
        }
    }

    if (!isGenerating) throw new DOMException("Se detuvo la generación.", "AbortError");
}
