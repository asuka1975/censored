import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyMutants } from '../lib/mutants.mjs';

const SOURCE = 'module A where\nf :: Int\nf = 1\nderive instance Eq T\ng = 2\n';
// 生成 1 行目 → PS 3 行目、生成 2 行目 → PS 4 行目、生成 3 行目 → PS 5 行目
const MAPPINGS = 'AAEA;AACA;AACA';
const mutant = (line, status, mutatorName = 'Arith') => ({ status, mutatorName, location: { start: { line, column: 1 } } });
const results = (mutants) => ({ files: { 'output/A/index.js': { mutants } } });
const deps = (over = {}) => ({
  changed: null,
  loadMap: () => ({ mappings: MAPPINGS, sourcePath: () => 'frontend/packages/core/src/A.purs' }),
  loadSource: () => SOURCE,
  ...over,
});

describe('ミュータントの分類', () => {
  it('殺されたものと生存したものを数える', () => {
    const r = classifyMutants(results([mutant(1, 'Killed'), mutant(1, 'Timeout'), mutant(3, 'Survived'), mutant(3, 'NoCoverage')]), deps());
    assert.equal(r.killed, 2);
    assert.equal(r.survived, 2);
    assert.equal(r.survivors.length, 2);
  });

  it('生成コードの行を判定から外す', () => {
    const r = classifyMutants(results([mutant(2, 'Survived')]), deps());
    assert.equal(r.survived, 0);
    assert.equal(r.ignored, 1);
  });

  it('差分モードでは変更していない行を判定から外す', () => {
    const changed = new Map([['frontend/packages/core/src/A.purs', new Set([3])]]);
    const r = classifyMutants(results([mutant(1, 'Survived'), mutant(3, 'Survived')]), deps({ changed }));
    assert.equal(r.survived, 1);
    assert.equal(r.ignored, 1);
  });

  it('ソースマップが無ければ合格にせず問題として報告する', () => {
    const r = classifyMutants(results([mutant(1, 'Survived')]), deps({ loadMap: () => null }));
    assert.equal(r.survived, 0);
    assert.equal(r.problems.length, 1);
  });

  it('対応する PS ファイルが無ければ問題として報告する', () => {
    const r = classifyMutants(results([mutant(1, 'Survived')]), deps({ loadSource: () => null }));
    assert.equal(r.problems.length, 1);
  });

  it('実行時エラーのミュータントを殺されたものとして数えない', () => {
    const r = classifyMutants(results([mutant(1, 'RuntimeError')]), deps());
    assert.equal(r.killed, 0);
    assert.equal(r.undetermined, 1);
  });

  it('対応のない区間のミュータントを別の行に数えない', () => {
    const r = classifyMutants(results([mutant(1, 'Survived')]), deps({
      loadMap: () => ({ mappings: 'A', sourcePath: () => 'x' }),
    }));
    assert.equal(r.survived, 0);
    assert.equal(r.ignored, 1);
  });
});
