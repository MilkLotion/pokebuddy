// [임시] 옛 자리 — src/tools 의 개발 도구 셋(dev-manage · dev-save · dev-test)과 시험 아홉(selftest-clock · commands · find · flow · manage · play · save-crypt · save · stage)이 이 경로의 옛 이름을 읽는다. 원본은 ./save-file.ts
// 읽는 쪽이 새 자리로 가면 이 파일을 지운다
export {
  backupName, brokenName, isSealedOnDisk as sealedOnDisk, lostMarkerOf as lostMarker, markSaveLost as markLost,
  readSave as read, readSaveRaw as readRaw, writeSave as write,
  type ReadSaveOptions as ReadV3Options, type ReadSaveResult as ReadV3Result,
} from "./save-file.js";
