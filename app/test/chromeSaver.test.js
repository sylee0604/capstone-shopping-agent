// chrome.storage 체크포인트: 패널을 닫았다 여는 상황(새 인스턴스)에서도 이어서 실행되는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/agent/graph.js';
import { runAgent } from '../src/agent/runner.js';
import { ChromeStorageSaver } from '../src/agent/chromeSaver.js';
import { makeMockNodes } from '../src/agent/mockNodes.js';

function fakeStorageArea() {
  const data = {};
  return { data, get: async (k) => ({ [k]: data[k] }), set: async (o) => Object.assign(data, o) };
}

test('패널을 닫았다 열어도(새 인스턴스) 상품 선택 대기 상태에서 이어서 실행', async () => {
  const area = fakeStorageArea();
  const script = { searchResults: [['a', 'b']] };

  // 1) 첫 실행: 상품 선택 직전에서 멈춘 채로 "패널을 닫음"
  const s1 = await ChromeStorageSaver.load(area);
  const g1 = buildGraph(makeMockNodes(script).nodes, { checkpointer: s1 });
  const closed = new Error('패널 닫힘');
  await assert.rejects(runAgent(g1, { request: { query: 'x' } }, { threadId: 'run1', onPause: async () => { throw closed; } }), /패널 닫힘/);
  assert.ok(area.data['agentCheckpoints.v1'].length > 0);

  // 2) 다시 열기: 저장소에서 복원한 새 인스턴스로 같은 thread 재개
  const s2 = await ChromeStorageSaver.load(area);
  const { nodes, trace } = makeMockNodes(script);
  const g2 = buildGraph(nodes, { checkpointer: s2 });
  const st = await g2.getState({ configurable: { thread_id: 'run1' } });
  assert.deepEqual(st.next, ['awaitSelection']);
  const final = await runAgent(g2, null, { threadId: 'run1', resume: true, onPause: async () => ({ selectedId: 'b' }) });
  assert.equal(final.recommendation.productId, 'b');
  assert.ok(!trace.includes('parseIntent'));        // 앞 단계는 다시 실행하지 않음
});

test('최근 10개 실행만 보관', async () => {
  const area = fakeStorageArea();
  const saver = await ChromeStorageSaver.load(area);
  for (let i = 0; i < 12; i++) {
    const g = buildGraph(makeMockNodes({ searchResults: [[]] }).nodes, { checkpointer: saver });
    await runAgent(g, { request: {} }, { threadId: `r${i}`, onPause: async () => ({}) });
  }
  const restored = await ChromeStorageSaver.load(area);
  assert.equal(Object.keys(restored.storage).length, 10);
  assert.ok(!('r0' in restored.storage) && 'r11' in restored.storage);
});
