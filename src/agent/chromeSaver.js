// chrome.storage.local에 체크포인트를 저장하는 checkpointer
// 사이드패널을 닫았다 열어도 같은 thread를 이어서 실행할 수 있게 한다.
import { MemorySaver } from '@langchain/langgraph/web';

const KEY = 'agentCheckpoints.v1';
const MAX_THREADS = 10;

// Uint8Array ↔ base64 (체크포인트 본문은 바이트 배열로 직렬화되어 있음)
function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
const replacer = (_k, v) => (v instanceof Uint8Array ? { __u8: toB64(v) } : v);
const reviver = (_k, v) => (v && typeof v === 'object' && typeof v.__u8 === 'string' ? fromB64(v.__u8) : v);

export class ChromeStorageSaver extends MemorySaver {
  /** @param area chrome.storage.local (테스트에서는 같은 인터페이스의 가짜 객체) */
  constructor(area, key = KEY) {
    super();
    this.area = area;
    this.key = key;
    this.order = [];          // 최근에 쓴 thread 순서 (오래된 것부터 삭제)
  }

  static async load(area, key = KEY) {
    const saver = new ChromeStorageSaver(area, key);
    const raw = (await area.get(key))[key];
    if (raw) {
      const data = JSON.parse(raw, reviver);
      Object.assign(saver.storage, data.storage);
      Object.assign(saver.writes, data.writes);
      saver.order = data.order ?? Object.keys(data.storage);
    }
    return saver;
  }

  touch(threadId) {
    this.order = this.order.filter((t) => t !== threadId).concat(threadId);
    while (this.order.length > MAX_THREADS) {
      const old = this.order.shift();
      delete this.storage[old];
      for (const k of Object.keys(this.writes)) if (JSON.parse(k)[0] === old) delete this.writes[k];
    }
  }

  async persist() {
    const raw = JSON.stringify({ storage: this.storage, writes: this.writes, order: this.order }, replacer);
    await this.area.set({ [this.key]: raw });
  }

  async put(config, checkpoint, metadata, newVersions) {
    const r = await super.put(config, checkpoint, metadata, newVersions);
    this.touch(config.configurable.thread_id);
    await this.persist();
    return r;
  }

  async putWrites(config, writes, taskId) {
    await super.putWrites(config, writes, taskId);
    await this.persist();
  }

  async deleteThread(threadId) {
    await super.deleteThread(threadId);
    this.order = this.order.filter((t) => t !== threadId);
    await this.persist();
  }
}
