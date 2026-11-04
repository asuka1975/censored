// ランタイムごとの差を閉じ込める。どちらも { info, load, generate, close } を返す。
// WHY NOT: ライブラリは npm の依存にしない。計測が終わったら捨てる道具で、台帳に登録する対象にしない。版を固定して CDN から取る。

export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
export const WLLAMA_URL = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js';
// wllama 自身の wasm-from-cdn.ts が指す場所と同じ。
export const WLLAMA_WASM_URL = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/src/wasm/wllama.wasm';

const now = () => performance.now();

async function createTransformersJs(config, onProgress) {
  const tjs = await import(TRANSFORMERS_URL);
  let generator = null;
  return {
    info: () => ({ library: 'transformers.js 4.3.2', device: config.backend, dtype: config.dtype }),
    async load() {
      generator = await tjs.pipeline('text-generation', config.repo, {
        dtype: config.dtype,
        device: config.backend,
        progress_callback: (p) => {
          if (p.status === 'progress_total') onProgress({ loaded: p.loaded, total: p.total });
        },
      });
    },
    async generate(messages) {
      let tokens = 0;
      let firstTokenAt = null;
      const started = now();
      const streamer = new tjs.TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: () => {},
        token_callback_function: () => {
          tokens += 1;
          firstTokenAt ??= now();
        },
      });
      const sampling = config.temperature > 0
        ? { do_sample: true, temperature: config.temperature, top_p: config.topP, top_k: config.topK }
        : { do_sample: false };
      const output = await generator(messages, { max_new_tokens: config.maxTokens, streamer, ...sampling });
      const finished = now();
      return {
        text: output[0].generated_text.at(-1)?.content ?? '',
        ttftMs: firstTokenAt === null ? null : firstTokenAt - started,
        totalMs: finished - started,
        tokens,
        truncated: tokens >= config.maxTokens,
      };
    },
    async close() {
      await generator?.dispose?.();
    },
  };
}

async function createWllama(config, onProgress) {
  const mod = await import(WLLAMA_URL);
  const wllama = new mod.Wllama({ default: WLLAMA_WASM_URL });
  return {
    info: () => ({
      library: 'wllama 3.8.1',
      webgpuSupported: wllama.isSupportWebGPU(),
      multithread: wllama.isModelLoaded() ? wllama.isMultithread() : null,
      threads: wllama.isModelLoaded() ? wllama.getNumThreads() : null,
    }),
    async load() {
      // WHY NOT: WebGPU が使えない端末で、黙って WASM に落とさない。経路が混ざると結果を比べられない。
      if (config.backend === 'webgpu' && !wllama.isSupportWebGPU()) throw new Error('wllama が WebGPU を使えないと報告した');
      await wllama.loadModelFromHF(
        { repo: config.repo, file: config.file, quant: config.file ? undefined : config.quant },
        {
          progressCallback: ({ loaded, total }) => onProgress({ loaded, total }),
          n_ctx: 2048,
          ...(config.backend === 'wasm' ? { n_gpu_layers: 0 } : {}),
          ...(config.threads ? { n_threads: config.threads } : {}),
          ...(config.jinja === undefined ? {} : { jinja: config.jinja }),
          ...(config.chatTemplate ? { chat_template: config.chatTemplate } : {}),
        },
      );
    },
    async generate(messages) {
      let tokens = 0;
      let text = '';
      let firstTokenAt = null;
      let finishReason = null;
      let completionTokens = null;
      const started = now();
      await wllama.createChatCompletion({
        messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        ...(config.topP === undefined ? {} : { top_p: config.topP }),
        ...(config.topK === undefined ? {} : { top_k: config.topK }),
        stream: true,
        onData: (chunk) => {
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) {
            tokens += 1;
            text += choice.delta.content;
            firstTokenAt ??= now();
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk.usage) completionTokens = chunk.usage.completion_tokens;
        },
      });
      const finished = now();
      return {
        text,
        ttftMs: firstTokenAt === null ? null : firstTokenAt - started,
        totalMs: finished - started,
        // wllama の 1 チャンクはほぼ 1 トークン。usage があればそちらを使う。
        tokens: completionTokens ?? tokens,
        truncated: finishReason === 'length',
      };
    },
    async close() {
      await wllama.exit();
    },
  };
}

export function createEngine(config, onProgress) {
  return config.runtime === 'wllama' ? createWllama(config, onProgress) : createTransformersJs(config, onProgress);
}
