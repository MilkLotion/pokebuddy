// 의존성 없는 최소 ZIP 리더. PMD 스프라이트 묶음을 메모리에서 푸는 데만 쓴다.
//
// 풀어서 디렉터리에 두지 않는 이유: 중간에 죽으면 반쯤 풀린 디렉터리가 정상으로 오인된다.
// ZIP 파일 하나를 통째로 캐시하고 쓸 때마다 메모리에서 푼다 (250KB deflate 는 수 ms).
//
// 지원: deflate(8) · 무압축(0). 암호화·ZIP64·deflate64 는 던진다 — PMD 자산에는 나오지 않는다.
// (예전 lib/zip.js. 도구 레인 T7a 에서 타입 검사를 받게 옮겼다)
import zlib from "node:zlib";

const EOCD_SIG = 0x06054b50; // PK\x05\x06 — 중앙 디렉터리 끝 기록
const CEN_SIG = 0x02014b50; // PK\x01\x02 — 중앙 디렉터리 항목
const LOC_SIG = 0x04034b50; // PK\x03\x04 — 각 파일 앞에 붙는 머리말

// EOCD 는 파일 끝에 있지만 주석이 최대 64KB 붙을 수 있어 뒤에서부터 찾는다
function findEocd(buf: Buffer): number {
  const from = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// { 이름 → Buffer }. 빈 아카이브면 빈 Map (던지지 않는다 — 호출한 쪽이 판단한다)
export function readZip(buf: Buffer): Map<string, Buffer> {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("ZIP 이 아님 — 너무 짧다");
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("ZIP 이 아님 — 끝 기록을 못 찾음");

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16); // 중앙 디렉터리 시작 위치
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CEN_SIG) break;
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // 디렉터리 항목
    if (buf.readUInt32LE(localAt) !== LOC_SIG) throw new Error(`머리말이 깨짐: ${name}`);
    // 로컬 머리말은 중앙 디렉터리와 길이가 다를 수 있다 — 반드시 여기서 다시 읽는다
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.subarray(dataAt, dataAt + compressed);

    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`지원하지 않는 압축 방식 ${method}: ${name}`);
  }
  return out;
}
