# ADR-0012: ブラウザ内 LLM の実行基盤は、WebGPU と WASM を 1 つで扱えるものに絞り、計測して決める

- Status: Proposed
- Date: 2026-11-04
- Deciders: asuka1975

## 背景

候補の生成は、利用者のブラウザの中で LLM を動かして行う。WebGPU を使い、使えない環境では WASM で動かす(人間の決定、2026-11-03。[プロダクト要求](../product/README.md))。サーバー側の生成は持たない。どのランタイムとモデルを使うかで、対応する端末、初回の待ち時間、候補の質が決まる([Issue #16](https://github.com/asuka1975/censored/issues/16))。

2026-11-04 に、到達できた一次情報で確かめたこと:

- **ブラウザの対応状況**(caniuse のデータ、2026-10-29 更新)。WebGPU は世界の利用の 85.8%(部分対応を除く。ほかに 3.66% が部分対応)。Chrome と Edge は 113 以降、iOS の Safari は 26.0 以降、Samsung Internet は 24 以降が対応する。Firefox は部分対応で、caniuse の注記は「初期設定で有効なのは、Windows と、Apple Silicon の macOS 26 以降だけ」。デスクトップの Safari も部分対応で、macOS 26 以降でだけ初期設定で有効。WebAssembly は 97.24%、WebAssembly SIMD は 96.53%、スレッドは 96.99%、SharedArrayBuffer は 96.94%。SharedArrayBuffer は、COOP と COEP のヘッダーによる cross-origin isolation を要する。これらは世界の集計で、日本の利用者に限った値ではない。
- **WebLLM**(`@mlc-ai/web-llm` 0.2.87、Apache-2.0)。README は「WebGPU で加速される」と書く。WebGPU を使わない実行経路の記述は無い。`wasm` と書かれているのは、モデルごとのコンパイル済みライブラリ(`model_lib`)のこと。事前に用意されたモデルに、日本語に調整された `gemma-2-2b-jpn-it`(`q4f16_1` で VRAM 約 1,895 MB)、`Qwen3-0.6B`(同 約 1,403 MB)、`Qwen3-1.7B`(同 約 2,037 MB)、`Qwen2.5-0.5B`(同 約 945 MB)、`Qwen2.5-1.5B`(同 約 1,630 MB)がある(`src/config.ts`、2026-11-04 時点)。
- **transformers.js**(`@huggingface/transformers` 4.3.2、Apache-2.0)。README は、ブラウザでの既定は WASM による CPU 実行で、`device: 'webgpu'` で GPU に切り替えられると書く。WebGPU は「多くのブラウザでまだ実験的」とも書く。既定で、モデルは Hugging Face Hub から、WASM のバイナリは CDN(jsDelivr)から取る。どちらも設定で自分のサーバーに置ける。依存の `onnxruntime-web` を、開発版(`1.31.0-dev.20260914-8d85527a0`)に固定している。
- **wllama**(`@wllama/wllama` 3.8.1、MIT)。llama.cpp の WebAssembly 版。GPU が無くても WASM の SIMD で動く。v3 から WebGPU にも対応した。マルチスレッドには COOP と COEP のヘッダーが要り、無いときは単一スレッド版に自動で切り替わる。モデルは GGUF 形式で、Q4、Q5、Q6 の量子化を勧めている。
- **MediaPipe の LLM Inference**(`@mediapipe/tasks-genai` 0.10.30、Apache-2.0)。公式の文書(`ai.google.dev`)に到達できず、対応する経路とモデルを確かめられなかった。
- **モデルのライセンス**。Qwen3 の公式リポジトリの README は「すべてのオープンウェイトのモデルは Apache 2.0」と書く。Gemma は、到達できる一次情報に書かれておらず、確かめられなかった。

**検証していないこと:** モデルの重みの置き場である Hugging Face(`huggingface.co`、`cdn-lfs.huggingface.co`)と `cdn.jsdelivr.net` へは、この環境のネットワーク方針が接続を拒否する(403)。GPU も無い。そのため、次を確かめていない。モデルの大きさ、初回の読み込み時間、生成の速さ、メモリの使用量、日本語の質、ONNX と GGUF の形式の配布の有無、Gemma と Qwen2.5 のライセンス。実際のブラウザでの WebGPU の動作も確かめていない。計測の手順は [評価の手順](../architecture/browser-llm-evaluation.md) に書いた。

## 決定

実行基盤は、WebGPU と WASM を 1 つのライブラリで扱える **transformers.js か wllama のどちらか**にする。WebGPU でしか動かない WebLLM は、基盤としては採らない。どちらにするかと、モデルは、[評価の手順](../architecture/browser-llm-evaluation.md) の計測の結果で決める。結果が出たら、この ADR の決定を更新してから、人間が承認する。

計測では、WebLLM と日本語に調整された `gemma-2-2b-jpn-it` を、品質の上限の目安として 1 構成だけ測る。基盤としては採らない。

MediaPipe は、確かめられなかったので、いまは候補に含めない。確かめられたら、評価に加える。

## 検討した代替案

### 案 A(採用): transformers.js か wllama に絞り、計測して決める

利点: 同じライブラリ、同じモデルの形式、同じプロンプトで、WebGPU と WASM の両方を扱える。実装と評価の経路が 1 本になる。どちらも、ブラウザ内で動く OSS で、ライセンスは Apache-2.0 と MIT。
欠点: 計測するまで、どちらかを選べない。transformers.js は開発版の `onnxruntime-web` に固定している。wllama は、マルチスレッドに COOP と COEP のヘッダーを要する。

### 案 B: WebGPU は WebLLM、WASM は wllama と、経路ごとに別のライブラリを使う

利点: WebLLM は、日本語に調整されたモデルを含む、事前に用意されたモデルの一覧を持つ。WebGPU の経路の質を、最も高くできる可能性がある。
欠点: 2 つのライブラリ、2 つのモデルの形式(MLC と GGUF)、2 つの経路のテストとプロンプトの調整を持つ。WebGPU の経路と WASM の経路で、候補の質と文体が変わる。
**却下理由:** 構成が倍になる費用に対して、質の差が見合うかは、計測していない。案 A の計測で、WebGPU の質の差が大きいと分かったら、再検討する。

### 案 C: WebLLM だけを使い、WebGPU が使えない環境は利用できないことにする

利点: 構成が最も単純。
欠点: WebGPU が初期設定で使えるのは世界の利用の 85.8% で、残りの約 14%(部分対応を含む)の環境で、投稿も返信もできなくなる。
**却下理由:** 人間の決定(2026-11-03)は、WebGPU が使えない環境でも WASM で動かすことだった。

## 結果

- 計測するまでは、基盤を 1 つに決められない。#15 のフロントエンドの core は、LLM を差し替え可能な部品の背後に置く(#15 の受け入れ条件)ので、この ADR の結論を待たずに進められる。
- どちらを選んでも、モデルの重みの配信(サイズが数百 MB から数 GB)が、帯域と費用の要因になる。置き場所(自前のサーバーか、CDN か、Hugging Face か)の判断が別に要る。
- wllama を選ぶと、マルチスレッドのために、サイトの全体に COOP と COEP を設定することになる。別のオリジンの画像や埋め込みは、CORP などの対応が要る。
- transformers.js を選ぶと、開発版の `onnxruntime-web` の固定を受け入れる。更新の追従が要る。
- 利用者の端末の性能に品質と速度が左右される。端末ごとの待ち時間の目標は、計測のあとに決める。

## 再検討の条件

- 計測の結果、transformers.js と wllama のどちらも、日本語の質か速度の基準を満たさないとき。そのときは、案 B(経路ごとに別のライブラリ)か、別のモデルを検討する。
- 選んだライブラリが、6 か月以上リリースされないとき。
- WebGPU を使えない環境の割合が、日本の利用者で大きく違うと分かったとき(世界の集計の値を使っている)。
- MediaPipe の LLM Inference が、WebGPU と WASM の両方に対応すると確かめられたとき。
