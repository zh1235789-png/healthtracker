// parseBodyRows() のオラクル。AIの意見ではなく実行結果で真偽を決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const TODAY = '2026-09-21T09:00:00+09:00';
// vm realm を跨ぐとプロトタイプが違い deepEqual が誤判定するため正規化する
const parse = (text) =>
  JSON.parse(JSON.stringify(loadApp({ today: TODAY }).parseBodyRows(text)));

test('日付つきの1行を正しく読む', () => {
  assert.deepEqual(parse('2026-09-20,77.5,17.1'),
    [{ date: '2026-09-20', kg: 77.5, fat: 17.1 }]);
});

test('体脂肪率が割合(0.171)なら%に直す', () => {
  assert.equal(parse('2026-09-20,77.5,0.171')[0].fat, 17.1);
});

test('日付が無ければ今日の記録として扱う（意図した仕様）', () => {
  assert.deepEqual(parse('77.5,17.1'),
    [{ date: '2026-09-21', kg: 77.5, fat: 17.1 }]);
});

test('ヘッダつきCSVを読む', () => {
  assert.deepEqual(parse('date,weight,fat\n2026-09-20,77.5,17.1'),
    [{ date: '2026-09-20', kg: 77.5, fat: 17.1 }]);
});

test('複数行・セミコロン区切りを読む', () => {
  assert.equal(parse('2026-09-19,77.0,17.0;2026-09-20,77.5,17.1').length, 2);
});

// ---- ここから回帰テスト（Codex が Medium で指摘した2件） ----

test('[回帰] 日付セルが日付でない文字列のとき、そこから体重を拾わない', () => {
  // "Sep 25" から数字 25 を体重として拾い、今日の記録として保存してしまわないか
  const rows = parse('date,weight,fat\nSep 25,77.5,17.1');
  assert.deepEqual(rows, [], `ゴミ行が取り込まれた: ${JSON.stringify(rows)}`);
});

test('[回帰] 日付列が先頭以外のCSVでも、体重と体脂肪を正しい列から読む', () => {
  assert.deepEqual(parse('weight,fat,date\n77.5,17.1,2026-09-20'),
    [{ date: '2026-09-20', kg: 77.5, fat: 17.1 }]);
});

test('[回帰] 存在しない日付(2026-13-45)を保存しない', () => {
  const rows = parse('2026-13-45,77.5,17.1');
  for (const r of rows) {
    const d = new Date(r.date + 'T00:00:00Z');
    assert.ok(!Number.isNaN(d.getTime()) && r.date === d.toISOString().slice(0, 10),
      `不正な日付が保存された: ${r.date}`);
  }
});

// ---- 修正が「日付なし取り込み」を壊していないかの確認 ----

test('日付なしで体重だけでも取り込める', () => {
  assert.deepEqual(parse('77.5'), [{ date: '2026-09-21', kg: 77.5, fat: null }]);
});

test('日付なし・タブ区切りでも取り込める', () => {
  assert.deepEqual(parse('77.5\t17.1'),
    [{ date: '2026-09-21', kg: 77.5, fat: 17.1 }]);
});

test('日付なしの行が複数あっても取り込める', () => {
  assert.equal(parse('77.5,17.1;77.6,17.2').length, 2);
});

test('数値でないゴミ行は落とす', () => {
  assert.deepEqual(parse('体重を記録しました'), []);
});

test('月末日は有効な日付として通す(2026-02-28)', () => {
  assert.equal(parse('2026-02-28,77.5,17.1')[0].date, '2026-02-28');
});

test('うるう年でない2月29日は捨てる(2026-02-29)', () => {
  assert.deepEqual(parse('2026-02-29,77.5,17.1'), []);
});

// ---- 単位つきの値（Codex が push 時に指摘した回帰） ----

test('[回帰] 日付なしで単位つきの値も取り込める', () => {
  assert.deepEqual(parse('77.5kg,17.1%'),
    [{ date: '2026-09-21', kg: 77.5, fat: 17.1 }]);
});

test('[回帰] 日付なしで単位つきの体重だけでも取り込める', () => {
  assert.deepEqual(parse('77.5kg'),
    [{ date: '2026-09-21', kg: 77.5, fat: null }]);
});

test('数字で始まっても日付らしい文字列は体重として拾わない', () => {
  assert.deepEqual(parse('date,weight,fat\n25 Sep,77.5,17.1'), []);
});

// ---- 変換できない単位（pre-push で Codex が High 指摘） ----

test('[回帰] ポンド表記を kg として保存しない', () => {
  const rows = parse('170lb,17.1%');
  assert.deepEqual(rows, [], `lb が kg として保存された: ${JSON.stringify(rows)}`);
});

test('[回帰] グラム表記を kg として保存しない', () => {
  for (const r of parse('77500g,17.1%')) {
    assert.equal(r.kg, null, `g が kg として保存された: ${r.kg}`);
  }
});

// ---- 列ごとの単位検証 ----

test('[回帰] 日付あり行でもポンド表記を kg として保存しない', () => {
  for (const r of parse('2026-09-20,170lb,17.1%')) {
    assert.equal(r.kg, null, `lb が kg として保存された: ${r.kg}`);
  }
});

test('[回帰] 日付あり行でもグラム表記を kg として保存しない', () => {
  for (const r of parse('2026-09-20,77500g,17.1%')) {
    assert.equal(r.kg, null, `g が kg として保存された: ${r.kg}`);
  }
});

test('[回帰] %付きの値を体重として保存しない', () => {
  for (const r of parse('77.5%,17.1')) {
    assert.equal(r.kg, null, `% 付きの値が kg として保存された: ${r.kg}`);
  }
});

test('[回帰] kg付きの値を体脂肪率として保存しない', () => {
  for (const r of parse('2026-09-20,77.5,17.1kg')) {
    assert.equal(r.fat, null, `kg 付きの値が fat として保存された: ${r.fat}`);
  }
});

test('正しい単位つきは引き続き取り込める', () => {
  assert.deepEqual(parse('2026-09-20,77.5kg,17.1%'),
    [{ date: '2026-09-20', kg: 77.5, fat: 17.1 }]);
});

test('全角%も体脂肪率として読む', () => {
  assert.equal(parse('2026-09-20,77.5,17.1％')[0].fat, 17.1);
});

test('単位と数値の間に空白があっても読む', () => {
  assert.deepEqual(parse('2026-09-20,77.5 kg,17.1 %'),
    [{ date: '2026-09-20', kg: 77.5, fat: 17.1 }]);
});

test('引用符つきCSVを引き続き読む', () => {
  assert.deepEqual(parse('"2026-09-20","77.5","17.1"'),
    [{ date: '2026-09-20', kg: 77.5, fat: 17.1 }]);
});

// ---- 旧実装で読めていた表記を落とさない ----

test('[回帰] 日付なしでも単位との間の空白を許す', () => {
  assert.deepEqual(parse('77.5 kg,17.1 %'),
    [{ date: '2026-09-21', kg: 77.5, fat: 17.1 }]);
});

test('[回帰] 先頭ゼロなしの小数(.171)を読む', () => {
  assert.equal(parse('2026-09-20,77.5,.171')[0].fat, 17.1);
});

test('[回帰] 日付なしでも先頭ゼロなしの小数を読む', () => {
  assert.deepEqual(parse('77.5,.171'),
    [{ date: '2026-09-21', kg: 77.5, fat: 17.1 }]);
});

test('[回帰] 末尾が小数点だけ(77.)でも読む', () => {
  assert.equal(parse('2026-09-20,77.,17.1')[0].kg, 77);
});
