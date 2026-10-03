// 저장을 쓰는 프로세스는 하나 — save.lock 에 pid 를 적어 잡는다 (config.js PATHS.saveLock). 잠금 규약은 src/platform/pid-lock.ts 다
//
// 누가 writer 가 되는지(독립 펫이 있으면 그것, 없으면 먼저 뜬 창 펫)는 부르는 쪽(main)이 정한다 —
// 창 펫이 독립 펫에 자리를 내주려면 놓은 뒤 독립 펫이 잡는다
//
// [임시] 옛 이름 — src/tools 의 selftest-legacy·stage 가 writer.* 로 읽는다. 원본은 src/platform/pid-lock.ts·pid.ts
export {
  claimLock as claim, liveLockOwner as owner, ownsLock as isMine, readLockPid as readOwner, releaseLock as release,
  type ClaimReason, type ClaimResult,
} from "../platform/pid-lock.js";
export { isPidAlive as pidAlive } from "../platform/pid.js";
